// Fleet page — vehicle list + live positions on MapLibre.
// Powered by Bouncie OBD-II trackers (trucks) and Trak-4 Portable (chipper/trailer, future).
// v421 (Apr 26, 2026)

var FleetPage = {
  _vehicles: [],
  _selectedId: null,
  _loading: true,
  _err: null,
  _refreshTimer: null,

  render: function() {
    var self = FleetPage;
    self._kickFetch();

    var html = '';

    // ── Header
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px;">'
      + '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'
      +   '<h3 style="font-size:16px;font-weight:700;margin:0;">Fleet</h3>'
      +   '<span style="font-size:13px;color:var(--text-light);">(' + self._vehicles.length + ')</span>'
      + '</div>'
      + '<div style="display:flex;gap:8px;">'
      +   '<button onclick="FleetPage.showAdd()" class="btn btn-primary" style="font-size:12px;">+ Add Vehicle</button>'
      +   '<button onclick="FleetPage._refresh(true)" class="btn btn-outline" style="font-size:12px;">↻ Refresh</button>'
      + '</div></div>';

    if (self._err) {
      html += '<div style="background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:8px;padding:12px;margin-bottom:12px;font-size:13px;">' + UI.esc(self._err) + '</div>';
    }

    if (self._loading && self._vehicles.length === 0) {
      html += '<div style="text-align:center;padding:30px;color:var(--text-light);font-size:13px;">Loading fleet…</div>';
      return html;
    }

    if (self._vehicles.length === 0) {
      html += '<div style="background:var(--white);border-radius:12px;padding:30px;text-align:center;border:1px solid var(--border);box-shadow:0 1px 3px rgba(0,0,0,0.04);">'
        + '<div style="font-size:36px;margin-bottom:8px;">🚛</div>'
        + '<div style="font-size:14px;font-weight:700;margin-bottom:4px;">No vehicles yet</div>'
        + '<div style="font-size:12px;color:var(--text-light);margin-bottom:14px;">Add your fleet vehicles. Bouncie OBD-II trackers will auto-register on first webhook event, or you can add manually below.</div>'
        + '<button onclick="FleetPage.showAdd()" class="btn btn-primary" style="font-size:12px;">+ Add Vehicle</button>'
        + '<details style="margin-top:18px;text-align:left;font-size:12px;color:var(--text-light);"><summary style="cursor:pointer;">Hardware setup notes</summary>'
        + '<ul style="margin-top:8px;padding-left:18px;line-height:1.6;">'
        + '<li><b>Trucks:</b> Bouncie OBD-II ($77/device + $96/yr). Plug into OBD port under dashboard. Auto-registers on first trip.</li>'
        + '<li><b>Chipper / trailer:</b> Trak-4 Portable (later). Battery-powered, magnetic mount. Manual add here.</li>'
        + '<li>Webhook URL for Bouncie: <code style="background:var(--bg);padding:1px 4px;border-radius:3px;">' + (window.SB_FUNC_URL || 'https://ltpivkqahvplapyagljt.supabase.co/functions/v1') + '/bouncie-webhook</code></li>'
        + '</ul></details>'
        + '</div>';
      return html;
    }

    // ── Live map (shows vehicles with last_lat/last_lon)
    var locatable = self._vehicles.filter(function(v) { return v.last_lat && v.last_lon; });
    if (locatable.length || true) {
      html += '<div id="fleet-map" style="height:360px;border-radius:12px;overflow:hidden;border:1px solid var(--border);margin-bottom:16px;background:var(--bg);"></div>';
      html += '<div id="fleet-map-status" style="font-size:11px;color:var(--text-light);margin:-12px 0 14px 4px;">' + (locatable.length ? locatable.length + ' vehicle' + (locatable.length===1?'':'s') + ' on map' : 'No live positions yet — install Bouncie / Trak-4 trackers and configure webhook') + '</div>';
      // Defer map init to next tick (after DOM render)
      setTimeout(FleetPage._initMap, 60);
    }

    // ── List view
    html += '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04);">';
    html += '<div class="data-table">';
    html += '<div class="data-table-header" style="display:grid;grid-template-columns:1.5fr 1fr 110px 110px 1fr 80px;gap:12px;padding:10px 16px;background:var(--bg);font-size:11px;font-weight:700;color:var(--text-light);text-transform:uppercase;letter-spacing:.4px;">'
      + '<div>Vehicle</div><div>Tracker</div><div>Status</div><div>Speed</div><div>Last Seen</div><div></div></div>';

    self._vehicles.forEach(function(v) {
      var status = self._statusOf(v);
      html += '<div onclick="FleetPage.showDetail(\'' + v.id + '\')" style="display:grid;grid-template-columns:1.5fr 1fr 110px 110px 1fr 80px;gap:12px;padding:12px 16px;border-top:1px solid var(--border);cursor:pointer;font-size:13px;align-items:center;">'
        + '<div><div style="font-weight:600;">' + UI.esc(v.name || '—') + '</div>'
        +   (v.nickname ? '<div style="font-size:11px;color:var(--text-light);">' + UI.esc(v.nickname) + '</div>' : '')
        + '</div>'
        + '<div style="font-size:12px;color:var(--text-light);">' + UI.esc(v.tracker_provider || 'none') + (v.tracker_device_id ? ' <span style="opacity:.6;">' + UI.esc(String(v.tracker_device_id).slice(-6)) + '</span>' : '') + '</div>'
        + '<div><span style="background:' + status.bg + ';color:' + status.fg + ';padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;">' + status.label + '</span></div>'
        + '<div>' + (v.last_speed_mph != null ? Math.round(v.last_speed_mph) + ' mph' : '—') + '</div>'
        + '<div style="font-size:12px;color:var(--text-light);">' + (v.last_seen_at ? UI.timeAgo(v.last_seen_at) : 'never') + '</div>'
        + '<div style="text-align:right;">' + (v.last_lat ? '<a href="https://maps.apple.com/?ll=' + v.last_lat + ',' + v.last_lon + '" target="_blank" rel="noopener noreferrer" style="color:var(--accent);text-decoration:none;font-size:12px;" onclick="event.stopPropagation();">📍 Map</a>' : '') + '</div>'
        + '</div>';
    });
    html += '</div></div>';

    return html;
  },

  _statusOf: function(v) {
    if (!v.last_seen_at) return { label: 'No data', bg: 'var(--bg)', fg: 'var(--text-light)' };
    var ageMin = (Date.now() - new Date(v.last_seen_at).getTime()) / 60000;
    if (ageMin < 5) {
      if (v.last_ignition === false) return { label: 'Parked', bg: '#e8f5e9', fg: '#2e7d32' };
      if ((v.last_speed_mph || 0) > 1) return { label: 'Driving', bg: '#fff3e0', fg: '#e07c24' };
      return { label: 'Idle', bg: '#fffde7', fg: '#a37200' };
    }
    if (ageMin < 60) return { label: 'Recent', bg: '#e3f2fd', fg: '#1565c0' };
    if (ageMin < 1440) return { label: 'Stale', bg: '#fff3e0', fg: '#a04400' };
    return { label: 'Offline', bg: '#fde8e8', fg: '#c62828' };
  },

  _kickFetch: function() {
    if (FleetPage._fetched) return;
    FleetPage._fetched = true;
    FleetPage._refresh(false);
  },

  _refresh: function(forceRender) {
    var self = FleetPage;
    self._loading = true;
    self._err = null;
    if (!window.SB || !SB.from) {
      self._err = 'Supabase client not ready';
      self._loading = false;
      if (forceRender) loadPage('fleet');
      return;
    }
    SB.from('vehicles').select('*').eq('active', true).order('name', { ascending: true }).then(function(r) {
      self._vehicles = r.data || [];
      if (r.error) self._err = r.error.message;
      self._loading = false;
      if (forceRender || !self._renderedOnce) {
        self._renderedOnce = true;
        loadPage('fleet');
      }
    });
  },

  showAdd: function() {
    UI.modal({
      title: 'Add Vehicle',
      html: '<div style="display:grid;gap:10px;">'
        + '<label style="font-size:11px;font-weight:700;color:var(--text-light);text-transform:uppercase;">Name<input id="fleet-name" placeholder="e.g. Bucket Truck #1" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-top:4px;"></label>'
        + '<label style="font-size:11px;font-weight:700;color:var(--text-light);text-transform:uppercase;">Nickname<input id="fleet-nick" placeholder="e.g. The Beast" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-top:4px;"></label>'
        + '<label style="font-size:11px;font-weight:700;color:var(--text-light);text-transform:uppercase;">License Plate<input id="fleet-plate" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-top:4px;"></label>'
        + '<label style="font-size:11px;font-weight:700;color:var(--text-light);text-transform:uppercase;">Type<select id="fleet-type" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-top:4px;">'
        +   '<option value="bucket">Bucket Truck</option><option value="dump">Dump Truck</option><option value="pickup">Pickup</option><option value="chipper">Chipper</option><option value="trailer">Trailer</option><option value="other">Other</option>'
        + '</select></label>'
        + '<label style="font-size:11px;font-weight:700;color:var(--text-light);text-transform:uppercase;">Tracker Provider<select id="fleet-tracker" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-top:4px;">'
        +   '<option value="">— None yet —</option><option value="bouncie">Bouncie OBD-II</option><option value="trak4">Trak-4 Portable</option><option value="manual">Manual entry</option>'
        + '</select></label>'
        + '<label style="font-size:11px;font-weight:700;color:var(--text-light);text-transform:uppercase;">Tracker Device ID<input id="fleet-device" placeholder="IMEI / VIN / serial — leave blank to auto-register on first event" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-top:4px;"></label>'
        + '</div>',
      buttons: [
        { label: 'Cancel', action: 'close' },
        { label: 'Save', primary: true, action: 'FleetPage.saveAdd()' }
      ]
    });
  },

  saveAdd: function() {
    var name = document.getElementById('fleet-name').value.trim();
    if (!name) { UI.toast('Name is required', 'error'); return; }
    var row = {
      tenant_id: window.CURRENT_TENANT_ID || '93af4348-8bba-4045-ac3e-5e71ec1cc8c5',
      name: name,
      nickname: document.getElementById('fleet-nick').value.trim() || null,
      license_plate: document.getElementById('fleet-plate').value.trim() || null,
      type: document.getElementById('fleet-type').value || 'truck',
      tracker_provider: document.getElementById('fleet-tracker').value || null,
      tracker_device_id: document.getElementById('fleet-device').value.trim() || null,
      active: true
    };
    SB.from('vehicles').insert(row).then(function(r) {
      if (r.error) { UI.toast('Save failed: ' + r.error.message, 'error'); return; }
      UI.toast('Vehicle added');
      UI.closeModal();
      FleetPage._fetched = false;
      FleetPage._refresh(true);
    });
  },

  showDetail: function(id) {
    FleetPage._selectedId = id;
    var v = FleetPage._vehicles.filter(function(x) { return x.id === id; })[0];
    if (!v) return;
    var status = FleetPage._statusOf(v);
    UI.modal({
      title: v.name + (v.nickname ? ' — ' + v.nickname : ''),
      html: '<div style="font-size:13px;line-height:1.7;">'
        + '<div><b>Status:</b> <span style="background:' + status.bg + ';color:' + status.fg + ';padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;">' + status.label + '</span></div>'
        + (v.last_seen_at ? '<div><b>Last seen:</b> ' + UI.timeAgo(v.last_seen_at) + '</div>' : '')
        + (v.last_lat ? '<div><b>Last position:</b> <a href="https://maps.apple.com/?ll=' + v.last_lat + ',' + v.last_lon + '" target="_blank" rel="noopener noreferrer" style="color:var(--accent);">' + v.last_lat.toFixed(5) + ', ' + v.last_lon.toFixed(5) + ' →</a></div>' : '')
        + (v.last_speed_mph != null ? '<div><b>Speed:</b> ' + Math.round(v.last_speed_mph) + ' mph</div>' : '')
        + (v.license_plate ? '<div><b>Plate:</b> ' + UI.esc(v.license_plate) + '</div>' : '')
        + (v.type ? '<div><b>Type:</b> ' + UI.esc(v.type) + '</div>' : '')
        + (v.tracker_provider ? '<div><b>Tracker:</b> ' + UI.esc(v.tracker_provider) + (v.tracker_device_id ? ' (' + UI.esc(v.tracker_device_id) + ')' : '') + '</div>' : '<div style="color:var(--text-light);"><b>Tracker:</b> not configured</div>')
        + '</div>',
      buttons: [
        { label: 'Close', action: 'close' },
        { label: 'Archive', action: 'FleetPage.archive(\'' + id + '\')' }
      ]
    });
  },

  _map: null,
  _markers: [],
  _initMap: function() {
    var el = document.getElementById('fleet-map');
    if (!el || typeof maplibregl === 'undefined' || el._initialized) return;
    el._initialized = true;
    var locatable = FleetPage._vehicles.filter(function(v) { return v.last_lat && v.last_lon; });
    var center = [-73.9212, 41.2901]; // Peekskill HQ default
    if (locatable.length) center = [locatable[0].last_lon, locatable[0].last_lat];
    FleetPage._map = new maplibregl.Map({
      container: 'fleet-map',
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center: center,
      zoom: 11
    });
    FleetPage._map.addControl(new maplibregl.NavigationControl(), 'top-right');
    FleetPage._map.on('load', function() {
      // HQ marker
      new maplibregl.Marker({ color: '#1a3c12' })
        .setLngLat([-73.9210, 41.2847])
        .setPopup(new maplibregl.Popup().setHTML('<strong>🏠 HQ</strong>'))
        .addTo(FleetPage._map);
      // Vehicle markers
      locatable.forEach(function(v) {
        var status = FleetPage._statusOf(v);
        var color = status.label === 'Driving' ? '#e07c24' : status.label === 'Parked' || status.label === 'Idle' ? '#2e7d32' : status.label === 'Offline' ? '#c62828' : '#1565c0';
        var m = new maplibregl.Marker({ color: color })
          .setLngLat([v.last_lon, v.last_lat])
          .setPopup(new maplibregl.Popup().setHTML('<strong>' + UI.esc(v.name) + '</strong><br>' + status.label + (v.last_speed_mph != null ? ' · ' + Math.round(v.last_speed_mph) + ' mph' : '') + '<br>' + UI.timeAgo(v.last_seen_at)))
          .addTo(FleetPage._map);
        FleetPage._markers.push(m);
      });
      // Auto-fit if multiple
      if (locatable.length > 1) {
        var b = new maplibregl.LngLatBounds();
        locatable.forEach(function(v) { b.extend([v.last_lon, v.last_lat]); });
        b.extend([-73.9210, 41.2847]);
        FleetPage._map.fitBounds(b, { padding: 40, maxZoom: 14 });
      }
    });
  },

  archive: function(id) {
    if (!confirm('Archive this vehicle? It will no longer receive position updates from its tracker.')) return;
    SB.from('vehicles').update({ active: false }).eq('id', id).then(function(r) {
      if (r.error) { UI.toast('Archive failed: ' + r.error.message, 'error'); return; }
      UI.toast('Vehicle archived');
      UI.closeModal();
      FleetPage._fetched = false;
      FleetPage._refresh(true);
    });
  }
};
