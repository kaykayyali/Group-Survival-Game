/*
 * Atmosphere: purely cosmetic, client-side lighting and post-processing.
 *
 * - Darkness is a real mask (bitmapData redrawn per frame) laid over the
 *   world; light exists only where holes are punched in it: the player's
 *   directional flashlight cone (follows aim, flickers, occasionally
 *   browns out) and a few flickering ambient sources (burning barrels).
 * - Muted ground: a desaturated cracked-asphalt tile fills the world.
 * - Post pass: cool contrast grade (multiply), vignette, animated film
 *   grain, and a desaturating hurt overlay. All of it deepens as HP falls;
 *   death drops the flashlight and pulls the screen to near-black.
 *
 * Server stays authoritative: nothing here touches gameplay state; HP and
 * alive are read from the latest snapshot.
 */
Atmosphere = function(game, state) {
    Fast_Bindall(this);
    this.game = game;
    this.state = state;
    this.client = state.client;
    this.smooth_hp = 100;
    this.alive = true;
    this.flashlight_brownout = 0;
    this.frame = 0;
    this.grain_index = 0;

    this.create_ground();
    this.create_static_map_layer();  // roads/buildings, painted when map data arrives
    this.create_decal_layer();       // persistent corpses and blood
    this.create_ambient_sources();
    this.create_edge_fog();
    this.create_overlays();
    this.try_paint_map();
};

Atmosphere.prototype.create_static_map_layer = function() {
    // World-sized canvas the decayed streetscape is painted onto once the
    // server's map layout arrives. Sits above the bare ground tile and
    // below the gore decals, structures and entities.
    var w = this.client.world.width, h = this.client.world.height;
    this.map_bmd = this.game.add.bitmapData(w, h);
    this.map_sprite = this.game.add.sprite(0, 0, this.map_bmd);
    this.map_painted = false;
};

Atmosphere.prototype.create_decal_layer = function() {
    // Kills mark the world permanently: corpses and blood are stamped into
    // this canvas and never cleared.
    var w = this.client.world.width, h = this.client.world.height;
    this.decal_bmd = this.game.add.bitmapData(w, h);
    this.decal_sprite = this.game.add.sprite(0, 0, this.decal_bmd);
};

Atmosphere.prototype.try_paint_map = function() {
    if (this.map_painted || !this.client.map) { return; }
    this.map_painted = true;
    this.paint_static_map(this.client.map);
};

Atmosphere.prototype.paint_static_map = function(map) {
    var ctx = this.map_bmd.context;
    var w = this.client.world.width, h = this.client.world.height;
    var roads = map.roads || [];
    var obstacles = map.obstacles || [];
    var i, j, o, x, y;

    function inside_building(px, py) {
        for (var b = 0; b < obstacles.length; b++) {
            var r = obstacles[b];
            if (px >= r.x - 4 && px <= r.x + r.w + 4 && py >= r.y - 4 && py <= r.y + r.h + 4) { return true; }
        }
        return false;
    }

    // --- Sidewalks bordering the roads ---
    ctx.fillStyle = '#232622';
    for (i = 0; i < roads.length; i++) {
        o = roads[i];
        if (o.w > o.h) { // horizontal
            ctx.fillRect(o.x, o.y - 28, o.w, 28);
            ctx.fillRect(o.x, o.y + o.h, o.w, 28);
        }
        else {
            ctx.fillRect(o.x - 28, o.y, 28, o.h);
            ctx.fillRect(o.x + o.w, o.y, 28, o.h);
        }
    }
    // Sidewalk slab joints.
    ctx.strokeStyle = 'rgba(10,12,10,0.5)';
    ctx.lineWidth = 1;
    for (i = 0; i < roads.length; i++) {
        o = roads[i];
        if (o.w > o.h) {
            for (x = o.x; x < o.x + o.w; x += 42) {
                ctx.beginPath(); ctx.moveTo(x, o.y - 28); ctx.lineTo(x, o.y); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(x, o.y + o.h); ctx.lineTo(x, o.y + o.h + 28); ctx.stroke();
            }
        }
        else {
            for (y = o.y; y < o.y + o.h; y += 42) {
                ctx.beginPath(); ctx.moveTo(o.x - 28, y); ctx.lineTo(o.x, y); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(o.x + o.w, y); ctx.lineTo(o.x + o.w + 28, y); ctx.stroke();
            }
        }
    }

    // --- Roads: worn asphalt, curbs, faded lane paint ---
    for (i = 0; i < roads.length; i++) {
        o = roads[i];
        ctx.fillStyle = '#17191b';
        ctx.fillRect(o.x, o.y, o.w, o.h);
        // Curb lines.
        ctx.strokeStyle = 'rgba(60,64,60,0.55)';
        ctx.lineWidth = 2;
        if (o.w > o.h) {
            ctx.beginPath(); ctx.moveTo(o.x, o.y + 1); ctx.lineTo(o.x + o.w, o.y + 1); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(o.x, o.y + o.h - 1); ctx.lineTo(o.x + o.w, o.y + o.h - 1); ctx.stroke();
        }
        else {
            ctx.beginPath(); ctx.moveTo(o.x + 1, o.y); ctx.lineTo(o.x + 1, o.y + o.h); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(o.x + o.w - 1, o.y); ctx.lineTo(o.x + o.w - 1, o.y + o.h); ctx.stroke();
        }
        // Faded center line, broken and skipped like old paint.
        ctx.fillStyle = 'rgba(150,132,62,0.20)';
        if (o.w > o.h) {
            var cy = o.y + o.h / 2 - 2;
            for (x = o.x + 10; x < o.x + o.w; x += 52) {
                if (Math.random() < 0.75) { ctx.fillRect(x, cy, 26, 4); }
            }
        }
        else {
            var cx = o.x + o.w / 2 - 2;
            for (y = o.y + 10; y < o.y + o.h; y += 52) {
                if (Math.random() < 0.75) { ctx.fillRect(cx, y, 4, 26); }
            }
        }
    }
    // Crosswalk stripes at the intersection (faded).
    if (roads.length >= 2) {
        var hr = roads[0].w > roads[0].h ? roads[0] : roads[1];
        var vr = roads[0].w > roads[0].h ? roads[1] : roads[0];
        ctx.fillStyle = 'rgba(170,175,170,0.10)';
        for (x = vr.x + 6; x < vr.x + vr.w - 6; x += 18) {
            ctx.fillRect(x, hr.y - 24, 10, 20);
            ctx.fillRect(x, hr.y + hr.h + 4, 10, 20);
        }
        for (y = hr.y + 6; y < hr.y + hr.h - 6; y += 18) {
            ctx.fillRect(vr.x - 24, y, 20, 10);
            ctx.fillRect(vr.x + vr.w + 4, y, 20, 10);
        }
        // Manholes.
        ctx.fillStyle = 'rgba(8,9,10,0.8)';
        draw_disc(ctx, vr.x + vr.w / 2 + 30, hr.y + 40, 9);
        draw_disc(ctx, vr.x - 60, hr.y + hr.h - 34, 9);
    }
    // Tire streaks and grime along the roads.
    for (i = 0; i < roads.length; i++) {
        o = roads[i];
        for (j = 0; j < 14; j++) {
            x = o.x + Math.random() * o.w;
            y = o.y + Math.random() * o.h;
            var gr = 16 + Math.random() * 40;
            var grd = ctx.createRadialGradient(x, y, 1, x, y, gr);
            grd.addColorStop(0, 'rgba(9,10,9,0.35)');
            grd.addColorStop(1, 'rgba(9,10,9,0)');
            ctx.fillStyle = grd;
            ctx.fillRect(x - gr, y - gr, gr * 2, gr * 2);
        }
    }

    // --- Old dried bloodstains: this place already went wrong ---
    for (i = 0; i < 9; i++) {
        x = Math.random() * w;
        y = Math.random() * h;
        if (inside_building(x, y)) { continue; }
        var br = 8 + Math.random() * 18;
        var bg = ctx.createRadialGradient(x, y, 1, x, y, br);
        bg.addColorStop(0, 'rgba(58,12,10,0.22)');
        bg.addColorStop(1, 'rgba(58,12,10,0)');
        ctx.fillStyle = bg;
        ctx.fillRect(x - br, y - br, br * 2, br * 2);
    }

    // --- Scattered debris: papers, rubble, junk ---
    for (i = 0; i < 160; i++) {
        x = Math.random() * w;
        y = Math.random() * h;
        if (inside_building(x, y)) { continue; }
        var kind_roll = Math.random();
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.random() * Math.PI * 2);
        if (kind_roll < 0.4) {         // newspaper / trash paper
            ctx.fillStyle = 'rgba(140,140,125,0.10)';
            ctx.fillRect(-4, -3, 8, 6);
        }
        else if (kind_roll < 0.75) {   // rubble chunk
            ctx.fillStyle = 'rgba(52,54,50,0.5)';
            ctx.fillRect(-2, -2, 3 + Math.random() * 3, 3 + Math.random() * 3);
        }
        else {                          // dark junk
            ctx.fillStyle = 'rgba(14,15,14,0.55)';
            ctx.fillRect(-3, -2, 6, 4);
        }
        ctx.restore();
    }

    // --- Structures ---
    for (i = 0; i < obstacles.length; i++) {
        o = obstacles[i];
        if (o.kind === 'building') { this.paint_building(ctx, o); }
        else if (o.kind === 'dumpster') { this.paint_dumpster(ctx, o); }
        else { this.paint_wreck(ctx, o); }
    }

    this.map_bmd.dirty = true;
};

Atmosphere.prototype.paint_building = function(ctx, o) {
    var jitter = (Math.random() * 10) | 0;
    // Ground shadow apron.
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.fillRect(o.x + 6, o.y + 8, o.w, o.h);
    // Walls.
    var wall = 34 + jitter;
    ctx.fillStyle = 'rgb(' + wall + ',' + (wall + 2) + ',' + (wall + 6) + ')';
    ctx.fillRect(o.x, o.y, o.w, o.h);
    // Roof, inset.
    var roof = 26 + jitter;
    ctx.fillStyle = 'rgb(' + roof + ',' + (roof + 1) + ',' + (roof + 5) + ')';
    ctx.fillRect(o.x + 7, o.y + 7, o.w - 14, o.h - 14);
    // Parapet catchlight on the north/west edges (cold moonlight).
    ctx.fillStyle = 'rgba(130,140,155,0.16)';
    ctx.fillRect(o.x, o.y, o.w, 2);
    ctx.fillRect(o.x, o.y, 2, o.h);
    // Roof grime and litter.
    var i, x, y;
    for (i = 0; i < Math.floor(o.w * o.h / 900); i++) {
        x = o.x + 9 + Math.random() * (o.w - 18);
        y = o.y + 9 + Math.random() * (o.h - 18);
        ctx.fillStyle = Math.random() < 0.5 ? 'rgba(10,11,12,0.4)' : 'rgba(70,74,80,0.12)';
        ctx.fillRect(x, y, 2 + Math.random() * 3, 2 + Math.random() * 3);
    }
    // Roof furniture: AC unit and a vent.
    if (o.w > 120) {
        x = o.x + 16 + Math.random() * (o.w - 60);
        y = o.y + 14 + Math.random() * (o.h - 50);
        ctx.fillStyle = '#3a3e44';
        ctx.fillRect(x, y, 26, 18);
        ctx.strokeStyle = 'rgba(15,16,18,0.8)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, 25, 17);
        ctx.beginPath();
        ctx.moveTo(x + 4, y + 9); ctx.lineTo(x + 22, y + 9);
        ctx.stroke();
        ctx.fillStyle = '#2c2f34';
        draw_disc(ctx, o.x + o.w - 22, o.y + o.h - 22, 7);
        ctx.fillStyle = 'rgba(90,96,104,0.25)';
        draw_disc(ctx, o.x + o.w - 22, o.y + o.h - 22, 3);
    }
    // South face: the wall you'd see at street level — dark doorways and
    // boarded windows, a hint of pseudo-3D.
    var face_h = 12;
    ctx.fillStyle = 'rgba(58,60,66,0.9)';
    ctx.fillRect(o.x, o.y + o.h - face_h, o.w, face_h);
    var openings = Math.max(2, Math.floor(o.w / 70));
    for (i = 0; i < openings; i++) {
        x = o.x + 12 + (i + 0.5) * ((o.w - 24) / openings) - 8;
        y = o.y + o.h - face_h + 2;
        ctx.fillStyle = '#0c0e0c';
        ctx.fillRect(x, y, 16, face_h - 3);
        // Boards nailed across.
        ctx.strokeStyle = 'rgba(96,82,58,0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - 1, y + 2); ctx.lineTo(x + 17, y + 6);
        ctx.moveTo(x - 1, y + 7); ctx.lineTo(x + 17, y + 3);
        ctx.stroke();
    }
    // Graffiti smear on some faces.
    if (Math.random() < 0.5) {
        ctx.fillStyle = 'rgba(120,40,40,0.28)';
        x = o.x + 10 + Math.random() * (o.w - 60);
        ctx.fillRect(x, o.y + o.h - face_h + 2, 30 + Math.random() * 20, 3);
    }
};

Atmosphere.prototype.paint_wreck = function(ctx, o) {
    var vertical = o.h > o.w;
    var cx = o.x + o.w / 2, cy = o.y + o.h / 2;
    var len = vertical ? o.h : o.w;
    var wid = vertical ? o.w : o.h;
    var palettes = [['#3c3f45', '#2c2e33'], ['#4a3b32', '#332a24'], ['#37413a', '#28302b']];
    var pal = palettes[(Math.random() * palettes.length) | 0];
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((vertical ? Math.PI / 2 : 0) + (Math.random() - 0.5) * 0.1);
    // Oil pool beneath.
    var og = ctx.createRadialGradient(0, 0, 2, 0, 0, len * 0.7);
    og.addColorStop(0, 'rgba(5,6,7,0.5)');
    og.addColorStop(1, 'rgba(5,6,7,0)');
    ctx.fillStyle = og;
    ctx.fillRect(-len * 0.7, -len * 0.7, len * 1.4, len * 1.4);
    // Body.
    ctx.fillStyle = pal[0];
    ctx.fillRect(-len / 2, -wid / 2, len, wid);
    // Cabin / windows.
    ctx.fillStyle = '#101317';
    if (o.kind === 'bus') {
        for (var wx = -len / 2 + 8; wx < len / 2 - 10; wx += 14) {
            ctx.fillRect(wx, -wid / 2 + 3, 9, 6);
            ctx.fillRect(wx, wid / 2 - 9, 9, 6);
        }
    }
    else {
        ctx.fillRect(-len * 0.16, -wid / 2 + 3, len * 0.3, wid - 6);
    }
    // Hood and trunk shading.
    ctx.fillStyle = pal[1];
    ctx.fillRect(len * 0.22, -wid / 2 + 2, len * 0.26, wid - 4);
    ctx.fillRect(-len / 2 + 2, -wid / 2 + 2, len * 0.14, wid - 4);
    // Rust and scorch.
    for (var r = 0; r < 5; r++) {
        var rx = (Math.random() - 0.5) * len * 0.8;
        var ry = (Math.random() - 0.5) * wid * 0.7;
        ctx.fillStyle = Math.random() < 0.6 ? 'rgba(122,74,38,0.35)' : 'rgba(10,10,10,0.5)';
        draw_disc(ctx, rx, ry, 2 + Math.random() * 4);
    }
    // A door hangs open on some wrecks.
    if (Math.random() < 0.6 && o.kind !== 'bus') {
        ctx.fillStyle = pal[0];
        ctx.fillRect(-len * 0.05, wid / 2, len * 0.16, wid * 0.34);
    }
    // Shattered glass glint around the cabin.
    ctx.fillStyle = 'rgba(150,165,180,0.25)';
    for (var g = 0; g < 8; g++) {
        ctx.fillRect((Math.random() - 0.5) * len * 0.9, (Math.random() - 0.3) * wid * 1.4, 1.5, 1.5);
    }
    ctx.restore();
};

Atmosphere.prototype.paint_dumpster = function(ctx, o) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(o.x + 3, o.y + 4, o.w, o.h);
    ctx.fillStyle = '#2e3a33';
    ctx.fillRect(o.x, o.y, o.w, o.h);
    ctx.strokeStyle = 'rgba(12,16,13,0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(o.x + 0.5, o.y + 0.5, o.w - 1, o.h - 1);
    // Lid split.
    ctx.beginPath();
    ctx.moveTo(o.x + o.w / 2, o.y); ctx.lineTo(o.x + o.w / 2, o.y + o.h);
    ctx.stroke();
    // Trash spilling out beside it.
    for (var t = 0; t < 7; t++) {
        var tx = o.x + o.w / 2 + (Math.random() - 0.5) * o.w * 1.8;
        var ty = o.y + o.h + Math.random() * 10;
        ctx.fillStyle = Math.random() < 0.5 ? 'rgba(130,130,110,0.16)' : 'rgba(30,34,28,0.6)';
        ctx.fillRect(tx, ty, 3 + Math.random() * 4, 2 + Math.random() * 3);
    }
};

function draw_disc(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
}

Atmosphere.prototype.create_ground = function() {
    // 256x256 grimy asphalt tile: desaturated near-dark base, slab joints,
    // speckle, cracks and old stains. Everything generated, no assets.
    var size = 256;
    var bmd = this.game.add.bitmapData(size, size);
    var ctx = bmd.context;
    ctx.fillStyle = '#20231f';
    ctx.fillRect(0, 0, size, size);

    // Slab joints.
    ctx.strokeStyle = 'rgba(12,14,12,0.9)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0.5, 0.5, size / 2, size / 2);
    ctx.strokeRect(size / 2 + 0.5, size / 2 + 0.5, size / 2, size / 2);

    // Speckle noise.
    var i, x, y;
    for (i = 0; i < 1500; i++) {
        x = Math.random() * size;
        y = Math.random() * size;
        var lum = Math.random();
        ctx.fillStyle = lum > 0.5 ?
            'rgba(46,50,44,' + (0.05 + Math.random() * 0.1).toFixed(2) + ')' :
            'rgba(10,12,10,' + (0.05 + Math.random() * 0.12).toFixed(2) + ')';
        ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }

    // Cracks: dark jagged polylines.
    ctx.strokeStyle = 'rgba(8,10,8,0.75)';
    ctx.lineWidth = 1;
    for (i = 0; i < 6; i++) {
        x = Math.random() * size;
        y = Math.random() * size;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (var seg = 0; seg < 6; seg++) {
            x += (Math.random() - 0.5) * 46;
            y += (Math.random() - 0.5) * 46;
            ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    // Old stains.
    for (i = 0; i < 4; i++) {
        x = Math.random() * size;
        y = Math.random() * size;
        var r = 12 + Math.random() * 26;
        var g = ctx.createRadialGradient(x, y, 1, x, y, r);
        g.addColorStop(0, 'rgba(14,13,11,0.35)');
        g.addColorStop(1, 'rgba(14,13,11,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    bmd.dirty = true;

    this.ground = this.game.add.tileSprite(
        0, 0, this.client.world.width, this.client.world.height, bmd);
    this.game.world.sendToBack(this.ground);
};

Atmosphere.prototype.create_ambient_sources = function() {
    // Burning barrels: the only light that isn't yours. Cosmetic and
    // deterministic; each punches a flickering warm hole in the darkness.
    var barrel_bmd = this.game.add.bitmapData(30, 38);
    var ctx = barrel_bmd.context;
    ctx.fillStyle = '#332e2a';
    ctx.fillRect(3, 8, 24, 28);
    ctx.fillStyle = '#3d3026';
    ctx.fillRect(3, 8, 24, 4);
    ctx.fillRect(3, 20, 24, 3);
    ctx.fillRect(3, 31, 24, 3);
    ctx.fillStyle = '#4a3423';           // rust streaks
    ctx.fillRect(7, 12, 3, 20);
    ctx.fillRect(20, 15, 2, 16);
    ctx.fillStyle = '#c9661f';           // ember mouth
    ctx.beginPath();
    ctx.ellipse ? ctx.ellipse(15, 8, 11, 4, 0, 0, Math.PI * 2) : ctx.arc(15, 8, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#eda23f';
    ctx.beginPath();
    ctx.ellipse ? ctx.ellipse(15, 8, 6, 2.4, 0, 0, Math.PI * 2) : ctx.arc(15, 8, 5, 0, Math.PI * 2);
    ctx.fill();
    barrel_bmd.dirty = true;

    var glow_bmd = this.game.add.bitmapData(200, 200);
    var gctx = glow_bmd.context;
    var grad = gctx.createRadialGradient(100, 100, 4, 100, 100, 96);
    grad.addColorStop(0, 'rgba(255,186,92,0.85)');
    grad.addColorStop(0.35, 'rgba(232,132,52,0.42)');
    grad.addColorStop(1, 'rgba(180,80,20,0)');
    gctx.fillStyle = grad;
    gctx.fillRect(0, 0, 200, 200);
    glow_bmd.dirty = true;

    // Corners and curbs of the crossroads — out on the street where the
    // horde passes, never inside a building footprint.
    var positions = [
        { x: 688, y: 524 }, { x: 908, y: 712 }, { x: 250, y: 712 },
        { x: 1352, y: 528 }, { x: 806, y: 166 }, { x: 772, y: 1052 }
    ];
    var self = this;
    this.ambient_lights = positions.map(function(pos, index) {
        var glow = self.game.add.sprite(pos.x, pos.y, glow_bmd);
        glow.anchor.set(0.5);
        glow.blendMode = PIXI.blendModes.ADD;
        var barrel = self.game.add.sprite(pos.x, pos.y, barrel_bmd);
        barrel.anchor.set(0.5, 0.6);
        return { x: pos.x, y: pos.y, glow: glow, phase: index * 1.7, level: 1 };
    });
};

Atmosphere.prototype.create_edge_fog = function() {
    // Fog banks close off the world's edges — the horde walks out of them.
    // Rendered above the darkness mask so the mist reads even in the dark.
    var w = this.client.world.width, h = this.client.world.height;
    var depth = 230;
    this.fog_group = this.game.add.group();

    // Gradient strips along each border (small bmd scaled up: smooth).
    var strip_h = this.game.add.bitmapData(64, depth);
    var g = strip_h.context.createLinearGradient(0, 0, 0, depth);
    g.addColorStop(0, 'rgba(148,156,148,0.52)');
    g.addColorStop(0.55, 'rgba(140,150,142,0.22)');
    g.addColorStop(1, 'rgba(140,150,142,0)');
    strip_h.context.fillStyle = g;
    strip_h.context.fillRect(0, 0, 64, depth);
    strip_h.dirty = true;

    var strip_v = this.game.add.bitmapData(depth, 64);
    var gv = strip_v.context.createLinearGradient(0, 0, depth, 0);
    gv.addColorStop(0, 'rgba(148,156,148,0.52)');
    gv.addColorStop(0.55, 'rgba(140,150,142,0.22)');
    gv.addColorStop(1, 'rgba(140,150,142,0)');
    strip_v.context.fillStyle = gv;
    strip_v.context.fillRect(0, 0, depth, 64);
    strip_v.dirty = true;

    var top = this.game.add.sprite(0, 0, strip_h);
    top.scale.set(w / 64, 1);
    var bottom = this.game.add.sprite(0, h, strip_h);
    bottom.scale.set(w / 64, -1);
    var left = this.game.add.sprite(0, 0, strip_v);
    left.scale.set(1, h / 64);
    var right = this.game.add.sprite(w, 0, strip_v);
    right.scale.set(-1, h / 64);
    this.fog_group.add(top);
    this.fog_group.add(bottom);
    this.fog_group.add(left);
    this.fog_group.add(right);

    // Drifting fog banks near the perimeter.
    var blob = this.game.add.bitmapData(160, 160);
    var bg = blob.context.createRadialGradient(80, 80, 4, 80, 80, 78);
    bg.addColorStop(0, 'rgba(150,160,150,0.45)');
    bg.addColorStop(0.6, 'rgba(146,156,148,0.20)');
    bg.addColorStop(1, 'rgba(146,156,148,0)');
    blob.context.fillStyle = bg;
    blob.context.fillRect(0, 0, 160, 160);
    blob.dirty = true;

    this.fog_blobs = [];
    for (var i = 0; i < 16; i++) {
        var edge = i % 4;
        var bx, by;
        if (edge === 0) { bx = Math.random() * w; by = Math.random() * 200; }
        else if (edge === 1) { bx = Math.random() * w; by = h - Math.random() * 200; }
        else if (edge === 2) { bx = Math.random() * 200; by = Math.random() * h; }
        else { bx = w - Math.random() * 200; by = Math.random() * h; }
        var sprite = this.game.add.sprite(bx, by, blob);
        sprite.anchor.set(0.5);
        sprite.scale.set(1.4 + Math.random() * 1.8);
        sprite.alpha = 0.16 + Math.random() * 0.16;
        this.fog_group.add(sprite);
        this.fog_blobs.push({ sprite: sprite, base_x: bx, base_y: by, phase: Math.random() * Math.PI * 2 });
    }
};

Atmosphere.prototype.update_fog = function() {
    var t = this.game.time.now / 1000;
    for (var i = 0; i < this.fog_blobs.length; i++) {
        var b = this.fog_blobs[i];
        b.sprite.x = b.base_x + Math.sin(t * 0.09 + b.phase) * 46;
        b.sprite.y = b.base_y + Math.cos(t * 0.07 + b.phase * 1.3) * 30;
        b.sprite.alpha = 0.14 + 0.1 * (0.5 + 0.5 * Math.sin(t * 0.16 + b.phase * 2.1));
    }
};

// ---- Persistent gore: stamped into the decal canvas, never cleared ----

Atmosphere.prototype.stamp_blood = function(x, y, heavy) {
    var ctx = this.decal_bmd.context;
    var dir = Math.random() * Math.PI * 2;
    var n = heavy ? 9 : 5;
    for (var i = 0; i < n; i++) {
        var throw_dist = Math.random() * (heavy ? 26 : 14);
        var spread = dir + (Math.random() - 0.5) * 1.6;
        var sx = x + Math.cos(spread) * throw_dist;
        var sy = y + Math.sin(spread) * throw_dist;
        ctx.fillStyle = 'rgba(88,12,9,' + (0.30 + Math.random() * 0.35).toFixed(2) + ')';
        draw_disc(ctx, sx, sy, 1.2 + Math.random() * (heavy ? 3.4 : 2.2));
    }
    this.decal_bmd.dirty = true;
};

Atmosphere.prototype.stamp_corpse = function(x, y, kind) {
    var ctx = this.decal_bmd.context;
    var angle = Math.random() * Math.PI * 2;
    var crawler = kind === 'crawler';
    var runner = kind === 'runner';

    // Blood pool first, off-center.
    var pr = crawler ? 13 + Math.random() * 6 : 17 + Math.random() * 9;
    var px = x + (Math.random() - 0.5) * 8;
    var py = y + (Math.random() - 0.5) * 8;
    var pg = ctx.createRadialGradient(px, py, 1, px, py, pr);
    pg.addColorStop(0, 'rgba(76,10,7,0.62)');
    pg.addColorStop(0.7, 'rgba(64,9,7,0.38)');
    pg.addColorStop(1, 'rgba(64,9,7,0)');
    ctx.fillStyle = pg;
    ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    var skin = crawler ? '#4f5245' : '#565b4c';
    var cloth = runner ? '#38312a' : '#2b2e27';
    // Splayed limbs: lines with round caps at broken angles.
    ctx.lineCap = 'round';
    ctx.strokeStyle = skin;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(4, -3); ctx.lineTo(14, -9 - Math.random() * 4);   // arm thrown up
    ctx.moveTo(3, 4); ctx.lineTo(11, 10 + Math.random() * 3);    // other arm
    ctx.stroke();
    ctx.strokeStyle = cloth;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-5, -2); ctx.lineTo(-14, -7 + Math.random() * 3); // leg
    if (!crawler) { ctx.moveTo(-5, 3); ctx.lineTo(-15, 8 - Math.random() * 3); }
    ctx.stroke();
    // Torso.
    ctx.fillStyle = cloth;
    draw_soft_ellipse(ctx, 0, 0, 9, 6.5);
    // Gut wound.
    ctx.fillStyle = 'rgba(96,14,10,0.85)';
    draw_soft_ellipse(ctx, 1, 1, 4, 2.6);
    // Head, lolled to one side.
    ctx.fillStyle = skin;
    draw_disc(ctx, 8.5, -4 + Math.random() * 8, 4.2);
    ctx.restore();

    // Spatter flung outward past the body.
    this.stamp_blood(x, y, true);
};

function draw_soft_ellipse(ctx, x, y, rx, ry) {
    ctx.beginPath();
    if (ctx.ellipse) { ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); }
    else {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(1, ry / rx);
        ctx.arc(0, 0, rx, 0, Math.PI * 2);
        ctx.restore();
    }
    ctx.fill();
}

Atmosphere.prototype.create_overlays = function() {
    var w = this.game.camera.width;
    var h = this.game.camera.height;

    // The darkness mask itself, redrawn every frame.
    this.darkness_bmd = this.game.add.bitmapData(w, h);
    this.darkness_sprite = this.game.add.sprite(0, 0, this.darkness_bmd);
    this.darkness_sprite.fixedToCamera = true;

    // Cool contrast grade: multiplies the lit scene toward a bleak,
    // desaturated blue-gray.
    var grade_bmd = this.game.add.bitmapData(8, 8);
    grade_bmd.context.fillStyle = '#9aa2ac';
    grade_bmd.context.fillRect(0, 0, 8, 8);
    grade_bmd.dirty = true;
    this.grade_sprite = this.game.add.sprite(0, 0, grade_bmd);
    this.grade_sprite.scale.set(w / 8, h / 8);
    this.grade_sprite.fixedToCamera = true;
    this.grade_sprite.blendMode = PIXI.blendModes.MULTIPLY;
    this.grade_sprite.alpha = 0.35;

    // Hurt overlay: flat dark-gray wash that drains color as HP falls
    // (dark so it mutes the lit areas instead of fogging the blacks).
    var hurt_bmd = this.game.add.bitmapData(8, 8);
    hurt_bmd.context.fillStyle = '#2e3138';
    hurt_bmd.context.fillRect(0, 0, 8, 8);
    hurt_bmd.dirty = true;
    this.hurt_sprite = this.game.add.sprite(0, 0, hurt_bmd);
    this.hurt_sprite.scale.set(w / 8, h / 8);
    this.hurt_sprite.fixedToCamera = true;
    this.hurt_sprite.alpha = 0;

    // Blood vignette: dark red creep from the edges at critical HP.
    this.red_vignette_sprite = this.game.add.sprite(0, 0, this.make_vignette(w, h, '90,10,8', 0.95, 0.24));
    this.red_vignette_sprite.fixedToCamera = true;
    this.red_vignette_sprite.alpha = 0;

    // Standard black vignette, always present, deepens when hurt.
    this.vignette_sprite = this.game.add.sprite(0, 0, this.make_vignette(w, h, '0,0,0', 0.82, 0.34));
    this.vignette_sprite.fixedToCamera = true;
    this.vignette_sprite.alpha = 0.72;

    // Film grain: three pre-rendered noise frames cycled with jitter.
    this.grain_sprites = [];
    for (var n = 0; n < 3; n++) {
        var gw = 416, gh = 312;
        var grain_bmd = this.game.add.bitmapData(gw, gh);
        var img = grain_bmd.context.createImageData(gw, gh);
        var data = img.data;
        for (var p = 0; p < data.length; p += 4) {
            var v = (Math.random() * 255) | 0;
            data[p] = v;
            data[p + 1] = v;
            data[p + 2] = v;
            data[p + 3] = (Math.random() * 64) | 0;
        }
        grain_bmd.context.putImageData(img, 0, 0);
        grain_bmd.dirty = true;
        var grain = this.game.add.sprite(0, 0, grain_bmd);
        grain.scale.set(2);
        grain.fixedToCamera = true;
        grain.alpha = 0.07;
        grain.visible = (n === 0);
        this.grain_sprites.push(grain);
    }
};

Atmosphere.prototype.make_vignette = function(w, h, rgb, edge_alpha, inner_stop) {
    var bmd = this.game.add.bitmapData(w, h);
    var ctx = bmd.context;
    var cx = w / 2, cy = h / 2;
    var outer = Math.sqrt(cx * cx + cy * cy);
    var g = ctx.createRadialGradient(cx, cy, outer * inner_stop, cx, cy, outer);
    g.addColorStop(0, 'rgba(' + rgb + ',0)');
    g.addColorStop(0.6, 'rgba(' + rgb + ',' + (edge_alpha * 0.45) + ')');
    g.addColorStop(1, 'rgba(' + rgb + ',' + edge_alpha + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    bmd.dirty = true;
    return bmd;
};

Atmosphere.prototype.update = function() {
    this.frame++;
    var snap = this.client.latest_snapshot;
    var hp = 100, alive = true;
    if (snap) {
        for (var i = 0; i < snap.players.length; i++) {
            if (snap.players[i].id === this.client.player_id) {
                hp = snap.players[i].hp;
                alive = snap.players[i].alive;
                break;
            }
        }
    }
    this.alive = alive;
    this.smooth_hp += (hp - this.smooth_hp) * 0.08;
    var hp01 = Math.max(0, Math.min(1, this.smooth_hp / 100));

    this.try_paint_map(); // welcome (with map layout) can land after create()
    this.update_ambient_flicker();
    this.update_fog();
    this.draw_darkness(hp01, alive);
    this.update_post(hp01, alive);
    this.raise_overlays();
};

Atmosphere.prototype.update_ambient_flicker = function() {
    var t = this.game.time.now / 1000;
    for (var i = 0; i < this.ambient_lights.length; i++) {
        var light = this.ambient_lights[i];
        var flick = 0.74 +
            0.14 * Math.sin(t * 9.1 + light.phase * 3.1) *
                   Math.sin(t * 5.3 + light.phase) +
            0.12 * Math.random();
        if (Math.random() < 0.012) { flick *= 0.45; }   // gutter
        light.level = flick;
        light.glow.alpha = 0.55 + flick * 0.45;
        light.glow.scale.set(0.85 + flick * 0.3);
    }
};

Atmosphere.prototype.draw_darkness = function(hp01, alive) {
    var cam = this.game.camera;
    var w = cam.width, h = cam.height;
    var ctx = this.darkness_bmd.context;

    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    // Wounded eyes: the world itself dims further as HP falls. Deep dark,
    // but a sliver of moonlight: big shapes — streets, buildings, the
    // horde — still read as silhouettes.
    var base = alive ? (0.885 + (1 - hp01) * 0.05) : 0.955;
    ctx.fillStyle = 'rgba(3,5,10,' + base.toFixed(3) + ')';
    ctx.fillRect(0, 0, w, h);

    // Everything below erases darkness: light is a hole in the mask.
    ctx.globalCompositeOperation = 'destination-out';

    // Ambient sources.
    var visible_lights = [];
    for (var i = 0; i < this.ambient_lights.length; i++) {
        var light = this.ambient_lights[i];
        var sx = light.x - cam.x;
        var sy = light.y - cam.y;
        var radius = 165 * (0.8 + light.level * 0.25);
        if (sx < -radius || sx > w + radius || sy < -radius || sy > h + radius) { continue; }
        visible_lights.push({ sx: sx, sy: sy, radius: radius, level: light.level });
        var la = 0.62 + light.level * 0.28;
        var g = ctx.createRadialGradient(sx, sy, 3, sx, sy, radius);
        g.addColorStop(0, 'rgba(255,255,255,' + la.toFixed(3) + ')');
        g.addColorStop(0.45, 'rgba(255,255,255,' + (la * 0.5).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(sx - radius, sy - radius, radius * 2, radius * 2);
    }

    // Moonlight catches the horde: a faint presence-glow around every
    // zombie so the mass reads as moving silhouettes even in the dark.
    var zombie_sprites = this.state.zombie_sprites || {};
    for (var zid in zombie_sprites) {
        var zs = zombie_sprites[zid];
        var zx = zs.x - cam.x;
        var zy = zs.y - cam.y;
        if (zx < -40 || zx > w + 40 || zy < -40 || zy > h + 40) { continue; }
        var zg = ctx.createRadialGradient(zx, zy, 2, zx, zy, 32);
        zg.addColorStop(0, 'rgba(255,255,255,0.20)');
        zg.addColorStop(0.6, 'rgba(255,255,255,0.10)');
        zg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = zg;
        ctx.fillRect(zx - 32, zy - 32, 64, 64);
    }

    // Player flashlight: directional, flickering, gone when you're down.
    var player = this.state.main_player;
    if (alive && player && player.sprite) {
        var px = player.sprite.x - cam.x;
        var py = player.sprite.y - cam.y;
        var rot = player.sprite.rotation;

        // Flicker: mostly steady, occasional brown-out stutter.
        if (this.flashlight_brownout > 0) { this.flashlight_brownout--; }
        else if (Math.random() < 0.006) { this.flashlight_brownout = 2 + (Math.random() * 4 | 0); }
        var steady = 0.93 + Math.random() * 0.07;
        var intensity = this.flashlight_brownout > 0 ? steady * (0.35 + Math.random() * 0.3) : steady;

        var flash = player.last_shot && (this.game.time.now - player.last_shot < 90);

        // Personal halo: enough to see your own feet, no more.
        var halo = flash ? 150 : 78;
        var halo_alpha = (flash ? 0.9 : 0.42) * intensity;
        var hg = ctx.createRadialGradient(px, py, 2, px, py, halo);
        hg.addColorStop(0, 'rgba(255,255,255,' + halo_alpha.toFixed(3) + ')');
        hg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = hg;
        ctx.fillRect(px - halo, py - halo, halo * 2, halo * 2);

        // Penumbra then core beam.
        var len = 430;
        var half = flash ? 0.52 : 0.40;
        this.punch_cone(ctx, px, py, rot, half + 0.22, len * 0.82, 0.30 * intensity);
        this.punch_cone(ctx, px, py, rot, half, len, (flash ? 1 : 0.93) * intensity);

        // Dust in the beam: a faint warm haze painted back over the hole,
        // so the flashlight reads as light, not just absent darkness.
        ctx.globalCompositeOperation = 'source-over';
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.arc(px, py, len, rot - half, rot + half);
        ctx.closePath();
        ctx.clip();
        var beam = ctx.createRadialGradient(px, py, 8, px, py, len);
        beam.addColorStop(0, 'rgba(255,232,180,' + (0.20 * intensity).toFixed(3) + ')');
        beam.addColorStop(0.5, 'rgba(255,225,170,' + (0.12 * intensity).toFixed(3) + ')');
        beam.addColorStop(1, 'rgba(255,225,170,0)');
        ctx.fillStyle = beam;
        ctx.fillRect(px - len, py - len, len * 2, len * 2);
        ctx.restore();
        var halo_haze = ctx.createRadialGradient(px, py, 2, px, py, halo);
        halo_haze.addColorStop(0, 'rgba(255,235,190,' + ((flash ? 0.30 : 0.10) * intensity).toFixed(3) + ')');
        halo_haze.addColorStop(1, 'rgba(255,235,190,0)');
        ctx.fillStyle = halo_haze;
        ctx.fillRect(px - halo, py - halo, halo * 2, halo * 2);
        ctx.globalCompositeOperation = 'destination-out';
    }

    // Warm haze over the ambient sources for the same reason.
    ctx.globalCompositeOperation = 'source-over';
    for (var v = 0; v < visible_lights.length; v++) {
        var vis = visible_lights[v];
        var haze = ctx.createRadialGradient(vis.sx, vis.sy, 2, vis.sx, vis.sy, vis.radius * 0.9);
        haze.addColorStop(0, 'rgba(255,160,70,' + (0.16 * vis.level).toFixed(3) + ')');
        haze.addColorStop(1, 'rgba(255,160,70,0)');
        ctx.fillStyle = haze;
        ctx.fillRect(vis.sx - vis.radius, vis.sy - vis.radius, vis.radius * 2, vis.radius * 2);
    }

    this.darkness_bmd.dirty = true;
};

Atmosphere.prototype.punch_cone = function(ctx, px, py, rot, half_angle, length, alpha) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.arc(px, py, length, rot - half_angle, rot + half_angle);
    ctx.closePath();
    ctx.clip();
    var g = ctx.createRadialGradient(px, py, 12, px, py, length);
    g.addColorStop(0, 'rgba(255,255,255,' + alpha.toFixed(3) + ')');
    g.addColorStop(0.5, 'rgba(255,255,255,' + (alpha * 0.82).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(px - length, py - length, length * 2, length * 2);
    ctx.restore();
};

Atmosphere.prototype.update_post = function(hp01, alive) {
    var t = this.game.time.now / 1000;
    var hurt = 1 - hp01;

    if (alive) {
        this.vignette_sprite.alpha = 0.72 + hurt * 0.28;
        this.hurt_sprite.alpha = hurt * 0.36;
        // Critical: creeping blood vignette with a slow heartbeat throb.
        var crit = Math.max(0, (0.35 - hp01) / 0.35);
        this.red_vignette_sprite.alpha = crit > 0 ?
            crit * (0.78 + 0.22 * Math.sin(t * 5.2)) : 0;
        if (crit > 0) { this.hurt_sprite.alpha += 0.06 * Math.sin(t * 5.2) * crit; }
    }
    else {
        // Down: nearly everything drains out of the frame.
        this.vignette_sprite.alpha = 1;
        this.hurt_sprite.alpha = 0.44;
        this.red_vignette_sprite.alpha = 0.4;
    }

    // Film grain: cycle noise frames with jitter; heavier when hurt/dead.
    var grain_alpha = (alive ? 0.06 + hurt * 0.09 : 0.16);
    if (this.frame % 3 === 0) {
        this.grain_sprites[this.grain_index].visible = false;
        this.grain_index = (this.grain_index + 1) % this.grain_sprites.length;
        var grain = this.grain_sprites[this.grain_index];
        grain.visible = true;
        grain.cameraOffset.x = -(Math.random() * 30) | 0;
        grain.cameraOffset.y = -(Math.random() * 22) | 0;
    }
    for (var i = 0; i < this.grain_sprites.length; i++) {
        this.grain_sprites[i].alpha = grain_alpha;
    }
};

Atmosphere.prototype.raise_overlays = function() {
    // Entities spawn on top of the world; every frame re-stack the light
    // mask and post pass above them, and the HUD above everything.
    var world = this.game.world;
    world.bringToTop(this.darkness_sprite);
    // Eye-shine floats above the darkness: pairs of pale eyes are how you
    // read the horde where no light reaches.
    if (this.state.zombie_eyes_group) { world.bringToTop(this.state.zombie_eyes_group); }
    // Fog sits above the darkness so the mist at the world's edges reads
    // even where no light reaches — the horde emerges through it.
    if (this.fog_group) { world.bringToTop(this.fog_group); }
    world.bringToTop(this.grade_sprite);
    world.bringToTop(this.hurt_sprite);
    world.bringToTop(this.red_vignette_sprite);
    world.bringToTop(this.vignette_sprite);
    for (var i = 0; i < this.grain_sprites.length; i++) {
        world.bringToTop(this.grain_sprites[i]);
    }
    var state = this.state;
    if (state.hud_status) { world.bringToTop(state.hud_status); }
    if (state.hud_wave) { world.bringToTop(state.hud_wave); }
    if (state.hud_dead) { world.bringToTop(state.hud_dead); }
    if (state.displayed_messages) {
        for (var m = 0; m < state.displayed_messages.length; m++) {
            world.bringToTop(state.displayed_messages[m]);
        }
    }
};
