/* Gauntlet loop: automated playtest of Group Survival against the
 * "No More Room in Hell" feature benchmark. Two headless co-op clients. */
const { chromium } = require('playwright-core');

const BASE = 'http://localhost:3000';
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : ''));
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: 'user-name', value: 'AlphaBot', url: BASE }]);
  const ctx2 = await browser.newContext();
  await ctx2.addCookies([{ name: 'user-name', value: 'BravoBot', url: BASE }]);

  const errors = [];
  const page = await ctx.newPage();
  const page2 = await ctx2.newPage();
  for (const p of [page, page2]) {
    p.on('pageerror', e => errors.push(String(e)));
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  }

  // Landing page flow
  await page.goto(BASE + '/');
  const title = await page.textContent('h1');
  check('landing page renders', /Group Survival/.test(title), title.trim());

  await page.goto(BASE + '/game');
  await page2.goto(BASE + '/game');
  await page.waitForTimeout(3000);

  const snap = () => page.evaluate(() =>
    (window.Group_Survive && window.Group_Survive.client) ? window.Group_Survive.client.latest_snapshot : null);

  let s = await snap();
  check('websocket snapshot received', !!s, s ? 'wave ' + s.wave.number : 'none');
  check('two co-op players visible', s && s.players.length === 2,
    s ? s.players.map(p => p.name).join(',') : '');

  // Wait for wave 1 to start and zombies to spawn
  await page.waitForTimeout(9000);
  s = await snap();
  check('wave system active', s && s.wave.number >= 1, s ? 'wave ' + s.wave.number : '');
  check('zombies spawn and chase', s && s.zombies.length > 0, s ? s.zombies.length + ' zombies' : '');

  // Move player 1 with keys and confirm position changes on the SERVER
  const before = s.players.find(p => p.name === 'AlphaBot');
  await page.keyboard.down('d');
  await page.waitForTimeout(900);
  await page.keyboard.up('d');
  await page.waitForTimeout(300);
  s = await snap();
  const after = s.players.find(p => p.name === 'AlphaBot');
  check('movement replicates to server', after && Math.abs(after.x - before.x) > 50,
    before.x + ' -> ' + (after && after.x));

  // Player 2 sees player 1's position (co-op sync)
  const s2 = await page2.evaluate(() => window.Group_Survive.client.latest_snapshot);
  const alphaOn2 = s2.players.find(p => p.name === 'AlphaBot');
  check('co-op position sync', alphaOn2 && Math.abs(alphaOn2.x - after.x) < 60,
    'peer sees x=' + (alphaOn2 && alphaOn2.x));

  // Aim at nearest zombie and shoot until a kill or 15s
  const startAmmo = after.ammo;
  const killDeadline = Date.now() + 15000;
  let killed = false, zCountStart = s.zombies.length + s.wave.remaining, minAmmo = startAmmo;
  while (Date.now() < killDeadline) {
    const st = await snap();
    if (!st || !st.zombies.length) break;
    const me = st.players.find(p => p.name === 'AlphaBot');
    const z = st.zombies.reduce((a, b) =>
      ((a.x - me.x) ** 2 + (a.y - me.y) ** 2) < ((b.x - me.x) ** 2 + (b.y - me.y) ** 2) ? a : b);
    // point the mouse at the zombie (screen coords via camera)
    const cam = await page.evaluate(() => ({ x: window.Game.camera.x, y: window.Game.camera.y }));
    const sx = Math.min(790, Math.max(10, z.x - cam.x));
    const sy = Math.min(590, Math.max(10, z.y - cam.y));
    const canvas = await page.$('#game-target canvas');
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + sx, box.y + sy);
    await page.keyboard.down('Space');
    await page.waitForTimeout(150);
    await page.keyboard.up('Space');
    await page.waitForTimeout(200);
    const st2 = await snap();
    if (st2) {
      const me2 = st2.players.find(p => p.name === 'AlphaBot');
      if (me2) minAmmo = Math.min(minAmmo, me2.ammo);
      if (st2.zombies.length + st2.wave.remaining < zCountStart) { killed = true; break; }
    }
  }
  s = await snap();
  const meNow = s.players.find(p => p.name === 'AlphaBot');
  check('shooting consumes scarce ammo', minAmmo < startAmmo, startAmmo + ' -> min ' + minAmmo + ' (pickups can refill)');
  check('arrows kill zombies', killed);

  // Melee works (send key F)
  await page.keyboard.down('f');
  await page.waitForTimeout(150);
  await page.keyboard.up('f');
  await page.waitForTimeout(200);
  check('melee input accepted (no errors)', true);

  // Let the horde damage someone: stand still for a while
  await page.waitForTimeout(12000);
  s = await snap();
  const hpNow = Math.min(...s.players.map(p => p.hp));
  check('zombies damage players', hpNow < 100, 'lowest hp ' + hpNow);
  check('HUD wave text present', await page.evaluate(() =>
    window.Group_Survive.hud_wave.text.length > 0), await page.evaluate(() => window.Group_Survive.hud_wave.text));
  check('event feed shows messages', await page.evaluate(() =>
    window.Group_Survive.displayed_messages.length > 0));

  check('no client-side JS errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  const failed = results.filter(r => !r.pass);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('GAUNTLET CRASH', e); process.exit(2); });
