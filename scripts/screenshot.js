/*
 * Photographer for the gauntlet loop: joins two players, plays ~20s of a
 * wave (one bot fights, one idles), and captures standardized screenshots
 * for the critics. Usage:
 *   PW_MODULE=<path to playwright-core> CHROME_PATH=<chromium> \
 *     node scripts/screenshot.js <output-dir> [base-url]
 */
var pw;
try { pw = require(process.env.PW_MODULE || 'playwright-core'); }
catch (e) { console.error('playwright-core not found; set PW_MODULE'); process.exit(2); }

var OUT = process.argv[2] || '.';
var BASE = process.argv[3] || 'http://localhost:3000';
var CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

(async function() {
  var browser = await pw.chromium.launch({ executablePath: CHROME });
  var ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addCookies([{ name: 'user-name', value: 'Ellis', url: BASE }]);
  var ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx2.addCookies([{ name: 'user-name', value: 'Marsh', url: BASE }]);

  var page = await ctx.newPage();
  var page2 = await ctx2.newPage();
  page.on('pageerror', function(e) { console.error('PAGEERROR', String(e)); });

  await page.goto(BASE + '/');
  await page.screenshot({ path: OUT + '/shot_landing.png' });

  await page.goto(BASE + '/game');
  await page2.goto(BASE + '/game');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: OUT + '/shot_calm.png' });

  // Wait into the first wave, then fight: aim at the nearest zombie and shoot.
  await page.waitForTimeout(8000);
  var deadline = Date.now() + 20000;
  var actionTaken = false;
  while (Date.now() < deadline) {
    var st = await page.evaluate(function() {
      if (!window.Group_Survive || !window.Group_Survive.client) { return null; }
      var snap = window.Group_Survive.client.latest_snapshot;
      var cam = window.Game ? { x: window.Game.camera.x, y: window.Game.camera.y } : { x: 0, y: 0 };
      return { snap: snap, cam: cam };
    });
    if (st && st.snap && st.snap.zombies.length) {
      var me = null;
      for (var i = 0; i < st.snap.players.length; i++) {
        if (st.snap.players[i].name === 'Ellis') { me = st.snap.players[i]; }
      }
      if (me) {
        var z = st.snap.zombies[0];
        var best = Infinity;
        st.snap.zombies.forEach(function(cand) {
          var d = (cand.x - me.x) * (cand.x - me.x) + (cand.y - me.y) * (cand.y - me.y);
          if (d < best) { best = d; z = cand; }
        });
        var canvas = await page.$('canvas');
        if (canvas) {
          var box = await canvas.boundingBox();
          // Canvas internal resolution matches its CSS size (the game boots
          // at window size), so world-to-screen is just camera-relative.
          var sx = Math.min(box.width - 5, Math.max(5, z.x - st.cam.x));
          var sy = Math.min(box.height - 5, Math.max(5, z.y - st.cam.y));
          var packed = 0;
          st.snap.zombies.forEach(function(z2) {
            var d2 = (z2.x - me.x) * (z2.x - me.x) + (z2.y - me.y) * (z2.y - me.y);
            if (d2 < 420 * 420) { packed += 1; }
          });
          await page.mouse.move(box.x + sx, box.y + sy);
          await page.keyboard.down('Space');
          if (!actionTaken && best < 350 * 350 && packed >= 5) {
            // Catch the release itself: flash, lance and tracer live for a
            // fraction of a second — shoot the frame inside that window.
            actionTaken = true;
            await page.waitForTimeout(80);
            await page.screenshot({ path: OUT + '/shot_action.png' });
          }
          else {
            await page.waitForTimeout(150);
          }
          await page.keyboard.up('Space');
        }
      }
    }
    // Marsh drifts toward Ellis so the frames show survivors together.
    try {
      var rel = await page2.evaluate(function() {
        if (!window.Group_Survive || !window.Group_Survive.client) { return null; }
        var snap = window.Group_Survive.client.latest_snapshot;
        if (!snap) { return null; }
        var me = null, mate = null;
        snap.players.forEach(function(p) {
          if (p.name === 'Marsh') { me = p; }
          if (p.name === 'Ellis') { mate = p; }
        });
        if (!me || !mate) { return null; }
        return { dx: mate.x - me.x, dy: mate.y - me.y };
      });
      if (rel && (Math.abs(rel.dx) > 120 || Math.abs(rel.dy) > 120)) {
        var fx = rel.dx > 0 ? 'd' : 'a';
        var fy = rel.dy > 0 ? 's' : 'w';
        await page2.keyboard.down(fx);
        await page2.keyboard.down(fy);
        await page2.waitForTimeout(220);
        await page2.keyboard.up(fx);
        await page2.keyboard.up(fy);
      }
    } catch (e) {}
    await page.waitForTimeout(120);
  }
  if (!actionTaken) {
    await page.screenshot({ path: OUT + '/shot_action.png' });
  }
  // Melee moment: wait for a zombie at arm's length, then swing the axe
  // and catch the sweep mid-arc.
  var meleeDeadline = Date.now() + 16000;
  var meleeTaken = false;
  while (Date.now() < meleeDeadline && !meleeTaken) {
    var ms = await page.evaluate(function() {
      if (!window.Group_Survive || !window.Group_Survive.client) { return null; }
      var snap = window.Group_Survive.client.latest_snapshot;
      if (!snap) { return null; }
      var me = null;
      for (var i = 0; i < snap.players.length; i++) {
        if (snap.players[i].name === 'Ellis') { me = snap.players[i]; }
      }
      if (!me || !snap.zombies.length) { return null; }
      var best = Infinity, bz = null;
      snap.zombies.forEach(function(z) {
        var d = (z.x - me.x) * (z.x - me.x) + (z.y - me.y) * (z.y - me.y);
        if (d < best) { best = d; bz = z; }
      });
      return { close: best < 110 * 110, dx: bz.x - me.x, dy: bz.y - me.y };
    });
    if (ms && ms.close) {
      await page.keyboard.down('v');
      await page.waitForTimeout(180);
      await page.screenshot({ path: OUT + '/shot_melee.png' });
      await page.keyboard.up('v');
      meleeTaken = true;
    }
    else if (ms) {
      // Walk toward the nearest zombie to force the encounter.
      var kx = ms.dx > 20 ? 'd' : (ms.dx < -20 ? 'a' : null);
      var ky = ms.dy > 20 ? 's' : (ms.dy < -20 ? 'w' : null);
      if (kx) { await page.keyboard.down(kx); }
      if (ky) { await page.keyboard.down(ky); }
      await page.waitForTimeout(350);
      if (kx) { await page.keyboard.up(kx); }
      if (ky) { await page.keyboard.up(ky); }
    }
    else {
      await page.waitForTimeout(300);
    }
  }
  // The late shot is its own moment: move off, let the wave press in.
  await page.keyboard.down('w');
  await page.keyboard.down('a');
  await page.waitForTimeout(900);
  await page.keyboard.up('w');
  await page.keyboard.up('a');
  await page.waitForTimeout(3200);
  await page.screenshot({ path: OUT + '/shot_late.png' });
  await browser.close();
  console.log('screenshots written to ' + OUT);
})().catch(function(e) { console.error('SCREENSHOT CRASH', e); process.exit(1); });
