// Daily Pre-Trip Inspection — FMCSA/DOT-compliant checklists tailored to the
// Second Nature Tree Service fleet. One vehicle picked per inspection; each has
// its own set of items. Records stored per-day per-vehicle in localStorage.

var DailyInspection = {

  // Fleet — edit here when you add/retire equipment.
  // Each vehicle: { id, label, icon, dot (DOT-required?), items: [section, [checks]] }
  _vehicles: [
    {
      id: 'altec_bucket', label: 'Altec Bucket Truck', icon: '🚛', dot: true,
      items: [
        ['Exterior walk-around', [
          'Tires — tread depth, cuts, pressure (all 6+)',
          'Lug nuts tight, no rust streaks',
          'Lights — headlights, brake, turn, hazards, reverse',
          'Reflectors + DOT reflective tape',
          'Mud flaps secure',
          'Fluid leaks under truck (oil, coolant, hydraulic)',
          'Fuel cap secure, no visible leaks'
        ]],
        ['Cab / engine', [
          'Engine oil level + color',
          'Coolant level (cold)',
          'Power steering + brake fluid',
          'Windshield — no cracks blocking view',
          'Wipers + washer fluid',
          'Horn + mirrors adjusted',
          'Parking brake holds',
          'Brake pedal firm, air pressure builds (if air brakes)',
          'Registration + insurance in glove box',
          'DOT medical card + CDL on driver',
          'Fire extinguisher charged + mounted',
          'Triangles / flares / first aid kit',
          'Spill kit + absorbent'
        ]],
        ['Boom / aerial', [
          'Boom controls (upper + lower) responsive',
          'Outriggers extend + lock; pads present',
          'Hydraulic hoses — no cracks or weeping',
          'PTO engages smoothly',
          'Dielectric test sticker current (within 12 mo)',
          'Bucket fiberglass — no cracks or punctures',
          'Bucket lanyard + tool holster present',
          'Emergency lower works (test from ground)',
          'Proximity warnings / horn works'
        ]],
        ['Chip box / bed', [
          'Chip door latches',
          'Bed lift hydraulics (cycle up / down)',
          'Chip box fluid level (if hydraulic dump)',
          'Bed safety prop accessible'
        ]]
      ]
    },
    {
      id: 'chip_truck', label: 'Chip Truck / Dump', icon: '🚚', dot: true,
      items: [
        ['Exterior', [
          'Tires — tread, pressure, no sidewall damage',
          'Lights — all around',
          'Reflectors, DOT tape, mud flaps',
          'No fluid leaks under vehicle',
          'Fuel cap secure'
        ]],
        ['Cab / engine', [
          'Oil + coolant + washer fluid',
          'Brake pedal + parking brake',
          'Wipers + horn + mirrors',
          'Registration + insurance + DOT docs',
          'Fire extinguisher + triangles'
        ]],
        ['Chip box / bed', [
          'Chip door latches secure',
          'Bed lift hydraulics cycle fully',
          'PTO engages + disengages cleanly',
          'Safety prop for raised bed accessible',
          'Tarp (if mounted) rolls + secures'
        ]]
      ]
    },
    {
      id: 'ram_pickup', label: 'Ram 2500 Pickup', icon: '🛻', dot: false,
      items: [
        ['Exterior', [
          'Tires + lights + mirrors',
          'Tow hitch pin, wiring harness, ball',
          'Bed — no loose gear',
          'No fluid leaks'
        ]],
        ['Cab', [
          'Oil + coolant + washer fluid',
          'Brakes firm, parking brake holds',
          'Registration + insurance in glove box',
          'Fire extinguisher + first aid kit',
          'Sandbag / shovel / kitty litter (winter)'
        ]]
      ]
    },
    {
      id: 'chipper', label: 'Bandit Chipper', icon: '🪵', dot: false,
      items: [
        ['Pre-start', [
          'Knives / blades — sharp, tight, no chips',
          'Anvil gap set correctly',
          'Feed wheel teeth + hydraulic hoses',
          'Belts — no cracks, correct tension',
          'Engine oil + fuel + hydraulic fluid',
          'Feed control bar + E-stop function',
          'Discharge chute clear + aimed correctly',
          'Safety shields + curtains in place'
        ]],
        ['Startup + test', [
          'Starts, idles smooth',
          'Feed bar stops wheels within 2 seconds',
          'Emergency kill works'
        ]]
      ]
    },
    {
      id: 'stump_grinder', label: 'Bandit Stump Grinder', icon: '⚙️', dot: false,
      items: [
        ['Pre-start', [
          'Teeth — sharp, tight, correct pattern',
          'Wheel hub bolts tight',
          'Belts + hydraulic hoses',
          'Engine oil + fuel + coolant',
          'Safety shield + curtain intact',
          'Tracks / wheels for mobility'
        ]],
        ['Startup + test', [
          'Engine starts + idles',
          'Wheel spin control works',
          'E-stop works'
        ]]
      ]
    },
    {
      id: 'mini_skid', label: 'Mini-skid / Loader', icon: '🚜', dot: false,
      items: [
        ['Pre-start', [
          'Tracks — no cracks, proper tension',
          'Hydraulic fluid + engine oil + fuel',
          'Hoses — no weeping',
          'Attachment quick-connect pins + wedge lock',
          'Safety bar / operator presence switch',
          'Lights, horn, backup alarm'
        ]]
      ]
    },
    {
      id: 'trailer', label: 'Trailer', icon: '🚗', dot: true,
      items: [
        ['Exterior', [
          'Tires — tread, pressure, sidewalls',
          'Wheel chocks present',
          'Safety chains cross-connected',
          'Coupler latches + breakaway cable attached',
          'Electric brakes engage (tap brake controller)'
        ]],
        ['Lights + load', [
          'Brake, turn, running lights',
          'License plate light',
          'Load secured — straps, chains, binders',
          'Nothing overhanging past DOT limits',
          'No fluid leaks from equipment on trailer'
        ]]
      ]
    }
  ],

  // Today's key for a given vehicle
  _keyFor: function(vehId) {
    var today = new Date().toISOString().split('T')[0];
    return 'bm-inspection-' + today + '-' + vehId;
  },

  isCompleteForVehicle: function(vehId) {
    return !!localStorage.getItem(DailyInspection._keyFor(vehId));
  },

  // Renders fleet grid + active inspection form + today's completions + history
  render: function() {
    var today = new Date().toISOString().split('T')[0];

    // Today's completions badge strip
    var completedToday = DailyInspection._vehicles.filter(function(v) { return DailyInspection.isCompleteForVehicle(v.id); });

    var html = '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:14px;">';

    // Header / summary
    html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;">'
      + '<div><div style="font-weight:700;font-size:14px;">Fleet pre-trip — ' + today + '</div>'
      + '<div style="font-size:12px;color:var(--text-light);">FMCSA/DOT-compliant checklists. Tap a vehicle to start.</div></div>'
      + '<div style="font-size:13px;color:var(--green-dark);font-weight:700;">' + completedToday.length + ' / ' + DailyInspection._vehicles.length + ' done today</div>'
      + '</div>';

    // Fleet grid
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;">';
    DailyInspection._vehicles.forEach(function(v) {
      var done = DailyInspection.isCompleteForVehicle(v.id);
      var bg = done ? '#e8f5e9' : 'var(--bg)';
      var bd = done ? '#2e7d32' : 'var(--border)';
      html += '<button type="button" onclick="DailyInspection.startVehicle(\'' + v.id + '\')" '
        + 'style="background:' + bg + ';border:1px solid ' + bd + ';border-radius:10px;padding:12px;text-align:left;cursor:pointer;display:flex;gap:10px;align-items:center;">'
        + '<span style="font-size:26px;">' + v.icon + '</span>'
        + '<div style="flex:1;min-width:0;">'
        +   '<div style="font-size:13px;font-weight:700;color:var(--text);">' + v.label + '</div>'
        +   '<div style="font-size:11px;color:var(--text-light);">' + (v.dot ? 'DOT required · ' : '') + v.items.reduce(function(s,sec){return s+sec[1].length;},0) + ' checks</div>'
        +   '<div style="font-size:11px;margin-top:2px;color:' + (done ? '#2e7d32' : '#e65100') + ';font-weight:600;">' + (done ? '✓ Inspected today' : '○ Not started') + '</div>'
        + '</div>'
        + '</button>';
    });
    html += '</div>';

    // Active inspection slot (populated by startVehicle)
    html += '<div id="insp-active" style="margin-top:16px;"></div>';

    html += '</div>';

    // 30-day history
    var history = [];
    try { history = JSON.parse(localStorage.getItem('bm-inspection-history') || '[]'); } catch(e) {}
    if (history.length) {
      html += '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px;">'
        + '<div style="font-weight:700;font-size:13px;margin-bottom:10px;">🗒 Recent inspections</div>'
        + '<div style="display:grid;grid-template-columns:1fr;gap:4px;">';
      history.slice(0, 30).forEach(function(r) {
        var pass = r.pass ? '✅' : '⚠️';
        html += '<div style="font-size:12px;padding:6px 10px;background:var(--bg);border-radius:6px;display:flex;justify-content:space-between;align-items:center;gap:8px;">'
          + '<span>' + pass + ' <strong>' + (r.vehicleLabel || r.vehicle || '—') + '</strong> · ' + (r.driver || '—') + '</span>'
          + '<span style="color:var(--text-light);">' + r.date + (r.pass ? '' : ' · ' + r.checked + '/' + r.total) + '</span>'
          + '</div>';
      });
      html += '</div></div>';
    }

    return html;
  },

  // Start / toggle inspection for a specific vehicle
  startVehicle: function(vehId) {
    var v = DailyInspection._vehicles.find(function(x){ return x.id === vehId; });
    if (!v) return;
    if (DailyInspection.isCompleteForVehicle(vehId)) {
      if (!confirm('Already inspected today. Re-do ' + v.label + '?')) return;
      localStorage.removeItem(DailyInspection._keyFor(vehId));
    }

    var totalCount = v.items.reduce(function(s,sec){return s+sec[1].length;},0);
    var html = '<div style="border:2px solid #e65100;border-radius:12px;padding:14px;background:#fff8ed;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">'
      +   '<div style="font-weight:700;font-size:15px;">' + v.icon + ' ' + v.label + '</div>'
      +   '<button onclick="document.getElementById(\'insp-active\').innerHTML=\'\';" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text-light);">×</button>'
      + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">'
      +   '<input type="text" id="insp-driver" placeholder="Driver name" style="padding:8px;border:1px solid var(--border);border-radius:6px;font-size:13px;">'
      +   '<input type="text" id="insp-plate" placeholder="Plate / unit #" style="padding:8px;border:1px solid var(--border);border-radius:6px;font-size:13px;">'
      + '</div>'
      + '<input type="text" id="insp-notes" placeholder="Defects / notes (optional)" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:13px;margin-bottom:10px;">';

    v.items.forEach(function(sec) {
      html += '<div style="font-size:12px;font-weight:700;color:#e65100;margin:10px 0 4px;text-transform:uppercase;letter-spacing:.04em;">' + sec[0] + '</div>';
      sec[1].forEach(function(item) {
        html += '<label style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;font-size:13px;cursor:pointer;border-bottom:1px solid #f5e8d6;">'
          +   '<input type="checkbox" class="insp-check" style="width:18px;height:18px;accent-color:#2e7d32;margin-top:1px;flex-shrink:0;" onchange="DailyInspection.count()">'
          +   '<span>' + item + '</span></label>';
      });
    });

    html += '<div style="margin-top:12px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">'
      + '<span id="insp-count" style="font-size:12px;color:var(--text-light);">0 / ' + totalCount + ' checked</span>'
      + '<div style="display:flex;gap:6px;">'
      +   '<button onclick="DailyInspection._checkAll()" style="background:var(--white);color:var(--text);border:1px solid var(--border);padding:8px 14px;border-radius:6px;font-size:12px;cursor:pointer;">Check all</button>'
      +   '<button onclick="DailyInspection.complete(\'' + vehId + '\')" style="background:#1b5e20;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;">✓ Complete</button>'
      + '</div></div>'
      + '</div>';

    document.getElementById('insp-active').innerHTML = html;
    // Pre-fill driver name if logged in
    var user = (typeof Auth !== 'undefined' && Auth.user) ? Auth.user.name : '';
    var d = document.getElementById('insp-driver');
    if (d && !d.value && user) d.value = user;
    document.getElementById('insp-active').scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  _checkAll: function() {
    document.querySelectorAll('.insp-check').forEach(function(c){ c.checked = true; });
    DailyInspection.count();
  },

  count: function() {
    var checks = document.querySelectorAll('.insp-check');
    var done = Array.from(checks).filter(function(c) { return c.checked; }).length;
    var el = document.getElementById('insp-count');
    if (el) el.textContent = done + ' / ' + checks.length + ' checked';
  },

  complete: function(vehId) {
    var v = DailyInspection._vehicles.find(function(x){ return x.id === vehId; });
    if (!v) return;
    var checks = document.querySelectorAll('.insp-check');
    var done = Array.from(checks).filter(function(c) { return c.checked; }).length;
    if (done < checks.length) {
      if (!confirm(done + ' of ' + checks.length + ' items checked. Complete anyway with defects noted?')) return;
    }
    var driver = (document.getElementById('insp-driver') || {}).value || '';
    var plate = (document.getElementById('insp-plate') || {}).value || '';
    var notes = (document.getElementById('insp-notes') || {}).value || '';
    if (!driver) { alert('Enter driver name'); return; }

    var today = new Date().toISOString().split('T')[0];
    var record = {
      date: today,
      driver: driver,
      vehicle: plate || v.id,
      vehicleId: v.id,
      vehicleLabel: v.label,
      checked: done,
      total: checks.length,
      pass: done === checks.length,
      notes: notes,
      completedAt: new Date().toISOString()
    };

    localStorage.setItem(DailyInspection._keyFor(vehId), JSON.stringify(record));
    var history = [];
    try { history = JSON.parse(localStorage.getItem('bm-inspection-history') || '[]'); } catch(e) {}
    history.unshift(record);
    if (history.length > 200) history = history.slice(0, 200);
    localStorage.setItem('bm-inspection-history', JSON.stringify(history));

    UI.toast((record.pass ? '✓ ' : '⚠️ ') + v.label + ' — ' + (record.pass ? 'all clear' : done + '/' + checks.length + ' passed'));
    if (typeof loadPage === 'function' && window._currentPage === 'pretrip') loadPage('pretrip');
  },

  // Back-compat: legacy code still calls isComplete() / toggle() globally.
  // Keep stubs so nothing breaks.
  isComplete: function() {
    return DailyInspection._vehicles.every(function(v){ return DailyInspection.isCompleteForVehicle(v.id); });
  },
  toggle: function() { /* legacy — no-op on new UI */ }
};
