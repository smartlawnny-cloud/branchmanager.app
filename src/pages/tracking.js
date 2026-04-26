/**
 * Branch Manager — Location Tracking Review page
 *
 * Shows detected_locations the passive tracker flagged as "pending" — places
 * where you dwelled 60+ min. One tap to tag as:
 *   • a Job site (link to existing job or create new)
 *   • a Client property (link to existing client)
 *   • the Yard (home base — auto-ignored going forward)
 *   • Ignore (not work-related)
 *
 * Reads/writes detected_locations in Supabase.
 */
var TrackingPage = {

  _pending:  null,
  _tagged:   null,
  _ignored:  null,
  _loading:  false,

  render: function() {
    var html = '<div style="max-width:860px;margin:0 auto;padding-bottom:80px;">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px;">'
      +   '<div>'
      +     '<h2 style="margin:0;font-size:22px;">🛰 Location Tracking</h2>'
      +     '<div style="font-size:12px;color:var(--text-light);margin-top:2px;">Places BM detected you dwelled at — tag job sites, ignore the rest.</div>'
      +   '</div>'
      +   '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
      +     '<button class="btn btn-outline" onclick="TrackingPage.refresh()" style="font-size:13px;">🔄 Refresh</button>'
      +     '<button class="btn btn-outline" onclick="loadPage(\'settings\')" style="font-size:13px;">⚙ Settings</button>'
      +   '</div>'
      + '</div>'

      // Status card — tracker on/off + quick stats
      + '<div id="trk-status" style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:16px;">Loading…</div>'

      // Tabs
      + '<div style="display:flex;gap:0;border-bottom:2px solid var(--border);margin-bottom:14px;">'
      +   '<button id="trk-tab-pending" onclick="TrackingPage._setTab(\'pending\')" style="padding:10px 18px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:700;color:var(--accent);border-bottom:2px solid var(--accent);margin-bottom:-2px;">Pending</button>'
      +   '<button id="trk-tab-tagged" onclick="TrackingPage._setTab(\'tagged\')" style="padding:10px 18px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:600;color:var(--text-light);border-bottom:2px solid transparent;margin-bottom:-2px;">Tagged</button>'
      +   '<button id="trk-tab-ignored" onclick="TrackingPage._setTab(\'ignored\')" style="padding:10px 18px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:600;color:var(--text-light);border-bottom:2px solid transparent;margin-bottom:-2px;">Ignored</button>'
      + '</div>'

      // List container
      + '<div id="trk-list" style="display:flex;flex-direction:column;gap:10px;">Loading…</div>'

      + '</div>';

    document.getElementById('pageContent').innerHTML = html;
    document.getElementById('pageTitle').textContent = 'Location Tracking';
    document.getElementById('pageAction').style.display = 'none';

    TrackingPage.refresh();
  },

  _currentTab: 'pending',
  _setTab: function(tab) {
    TrackingPage._currentTab = tab;
    ['pending','tagged','ignored'].forEach(function(t) {
      var b = document.getElementById('trk-tab-' + t);
      if (!b) return;
      if (t === tab) {
        b.style.color = 'var(--accent)';
        b.style.borderBottomColor = 'var(--accent)';
        b.style.fontWeight = '700';
      } else {
        b.style.color = 'var(--text-light)';
        b.style.borderBottomColor = 'transparent';
        b.style.fontWeight = '600';
      }
    });
    TrackingPage._renderList();
  },

  refresh: function() {
    if (TrackingPage._loading) return;
    TrackingPage._loading = true;
    TrackingPage._renderStatus();
    var list = document.getElementById('trk-list');
    if (list) list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-light);">Loading…</div>';

    if (!SupabaseDB || !SupabaseDB.ready) {
      if (list) list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--red);">Supabase not ready. Refresh the app.</div>';
      TrackingPage._loading = false;
      return;
    }

    var tid = (typeof DB !== 'undefined' && DB.getTenantId) ? DB.getTenantId() : null;
    if (!tid) { TrackingPage._loading = false; return; }

    SupabaseDB.client.from('detected_locations')
      .select('*')
      .eq('tenant_id', tid)
      .order('last_seen_at', { ascending: false })
      .limit(200)
      .then(function(res) {
        TrackingPage._loading = false;
        if (res.error) {
          if (list) list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--red);">Error: ' + UI.esc(res.error.message) + '<br><small>Run migrate-location-tracking.sql in Supabase SQL editor if table is missing.</small></div>';
          return;
        }
        var all = res.data || [];
        TrackingPage._pending = all.filter(function(r){ return r.status === 'pending'; });
        TrackingPage._tagged  = all.filter(function(r){ return r.status === 'tagged' || r.status === 'yard'; });
        TrackingPage._ignored = all.filter(function(r){ return r.status === 'ignored'; });
        TrackingPage._renderStatus();
        TrackingPage._renderList();
      });
  },

  _renderStatus: function() {
    var el = document.getElementById('trk-status');
    if (!el) return;
    var on = localStorage.getItem('bm-passive-track') === 'true';
    var running = (typeof PassiveTracker !== 'undefined') ? PassiveTracker.status().running : false;
    var pend = TrackingPage._pending ? TrackingPage._pending.length : '…';
    var tag  = TrackingPage._tagged  ? TrackingPage._tagged.length  : '…';
    el.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">'
      +   '<div>'
      +     '<div style="font-size:13px;"><strong>Tracker:</strong> '
      +       '<span style="color:' + (on && running ? 'var(--green-dark)' : (on ? '#e07c24' : 'var(--text-light)')) + ';font-weight:700;">'
      +         (on && running ? '● Running' : (on ? '● Enabled, not active (foreground only)' : '○ Off'))
      +       '</span>'
      +     '</div>'
      +     '<div style="font-size:11px;color:var(--text-light);margin-top:2px;">'
      +       pend + ' pending · ' + tag + ' tagged'
      +     '</div>'
      +   '</div>'
      +   '<div style="display:flex;gap:6px;">'
      +     (on
          ? '<button class="btn btn-outline" style="font-size:12px;" onclick="localStorage.setItem(\'bm-passive-track\',\'false\');if(typeof PassiveTracker!==\'undefined\')PassiveTracker.stop();TrackingPage.refresh();">Turn Off</button>'
          : '<button class="btn btn-primary" style="font-size:12px;" onclick="localStorage.setItem(\'bm-passive-track\',\'true\');if(typeof PassiveTracker!==\'undefined\')PassiveTracker.start();TrackingPage.refresh();">Turn On</button>')
      +   '</div>'
      + '</div>';
  },

  _renderList: function() {
    var list = document.getElementById('trk-list');
    if (!list) return;
    var rows;
    if (TrackingPage._currentTab === 'pending') rows = TrackingPage._pending || [];
    else if (TrackingPage._currentTab === 'tagged') rows = TrackingPage._tagged || [];
    else rows = TrackingPage._ignored || [];

    if (!rows.length) {
      list.innerHTML = '<div style="padding:40px 20px;text-align:center;color:var(--text-light);">'
        + '<div style="font-size:36px;margin-bottom:10px;">🛰</div>'
        + '<div>No ' + TrackingPage._currentTab + ' locations.</div>'
        + (TrackingPage._currentTab === 'pending' ? '<div style="font-size:12px;margin-top:6px;">The tracker will detect places you spend 60+ min in — come back here to tag them.</div>' : '')
        + '</div>';
      return;
    }

    list.innerHTML = rows.map(function(r){ return TrackingPage._row(r); }).join('');
  },

  _row: function(r) {
    var dwell = r.dwell_minutes || 0;
    var dwellTxt = dwell >= 60 ? (dwell / 60).toFixed(1) + ' hrs' : dwell + ' min';
    var firstSeen = r.first_seen_at ? new Date(r.first_seen_at) : null;
    var lastSeen  = r.last_seen_at  ? new Date(r.last_seen_at)  : null;
    var when = firstSeen
      ? firstSeen.toLocaleDateString([], {month:'short',day:'numeric'}) + ' · ' + firstSeen.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})
      : '';
    var coords = r.center_lat.toFixed(5) + ', ' + r.center_lng.toFixed(5);
    var mapsUrl = 'https://maps.apple.com/?q=' + r.center_lat + ',' + r.center_lng;
    var statusBadge = {
      'pending':  '<span style="background:#fff3e0;color:#e07c24;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;">PENDING</span>',
      'tagged':   '<span style="background:var(--green-bg);color:var(--green-dark);padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;">TAGGED</span>',
      'yard':     '<span style="background:#e3f2fd;color:#1565c0;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;">YARD</span>',
      'ignored':  '<span style="background:#f5f5f5;color:var(--text-light);padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;">IGNORED</span>'
    }[r.status] || '';

    var linkedLabel = '';
    if (r.job_id)    linkedLabel = '🔧 Linked to job';
    else if (r.client_id) linkedLabel = '👤 Linked to client';
    else if (r.label) linkedLabel = '🏷 ' + UI.esc(r.label);

    var actions = '';
    if (r.status === 'pending') {
      actions = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:6px;margin-top:10px;">'
        + '<button class="btn btn-primary" style="font-size:12px;padding:8px;" onclick="TrackingPage._promptTag(\'' + r.id + '\')">🏷 Tag</button>'
        + '<button class="btn btn-outline" style="font-size:12px;padding:8px;" onclick="TrackingPage._markYard(\'' + r.id + '\')">🏠 Yard</button>'
        + '<button class="btn btn-outline" style="font-size:12px;padding:8px;" onclick="TrackingPage._ignore(\'' + r.id + '\')">✕ Ignore</button>'
        + '<button class="btn btn-outline" style="font-size:12px;padding:8px;" onclick="TrackingPage._delete(\'' + r.id + '\')">🗑 Delete</button>'
        + '</div>';
    } else {
      actions = '<div style="display:flex;gap:6px;margin-top:10px;">'
        + '<button class="btn btn-outline" style="font-size:12px;padding:6px 12px;" onclick="TrackingPage._reset(\'' + r.id + '\')">↺ Back to Pending</button>'
        + '<button class="btn btn-outline" style="font-size:12px;padding:6px 12px;" onclick="TrackingPage._delete(\'' + r.id + '\')">🗑 Delete</button>'
        + '</div>';
    }

    return '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,0.04);">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:6px;flex-wrap:wrap;">'
      +   '<div>'
      +     '<div style="font-size:14px;font-weight:700;">' + (r.address_guess ? UI.esc(r.address_guess) : coords) + '</div>'
      +     '<div style="font-size:12px;color:var(--text-light);margin-top:2px;">' + when + ' · dwelled ' + dwellTxt + ' · ' + (r.ping_count || 0) + ' pings</div>'
      +     (linkedLabel ? '<div style="font-size:12px;color:var(--accent);margin-top:4px;font-weight:600;">' + linkedLabel + '</div>' : '')
      +   '</div>'
      +   '<div>' + statusBadge + '</div>'
      + '</div>'
      + '<div style="display:flex;gap:10px;font-size:11px;margin-top:4px;">'
      +   '<a href="' + mapsUrl + '" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none;">📍 Open in Maps</a>'
      + '</div>'
      + actions
      + '</div>';
  },

  // ── Tag flow ──
  _promptTag: function(id) {
    var r = (TrackingPage._pending || []).find(function(x){ return x.id === id; });
    if (!r) return;

    var clients = [];
    try { clients = JSON.parse(localStorage.getItem('bm-clients') || '[]'); } catch(e) {}
    var jobs = [];
    try { jobs = DB.jobs.getAll().filter(function(j){ return j.status === 'scheduled' || j.status === 'in_progress'; }); } catch(e) {}

    var html = '<div style="margin-bottom:12px;font-size:13px;color:var(--text-light);">'
      + 'Tag this location. If you pick a job or client, future arrivals here will auto-trigger (when Auto Clock-In is ON).'
      + '</div>'
      + '<label style="font-size:12px;font-weight:700;">Link to job (optional)</label>'
      + '<select id="tag-job" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:14px;margin-bottom:12px;">'
      +   '<option value="">— none —</option>'
      +   jobs.map(function(j){ return '<option value="' + j.id + '">#' + (j.jobNumber||'') + ' — ' + UI.esc(j.clientName || '') + ' · ' + UI.esc(j.description || '') + '</option>'; }).join('')
      + '</select>'
      + '<label style="font-size:12px;font-weight:700;">Link to client (optional)</label>'
      + '<select id="tag-client" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:14px;margin-bottom:12px;">'
      +   '<option value="">— none —</option>'
      +   clients.map(function(c){ return '<option value="' + c.id + '">' + UI.esc(c.name || '') + (c.address ? ' · ' + UI.esc(c.address) : '') + '</option>'; }).join('')
      + '</select>'
      + '<label style="font-size:12px;font-weight:700;">Free-form label (optional)</label>'
      + '<input type="text" id="tag-label" placeholder="e.g. Lunch at Subway, New lead property" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:14px;margin-bottom:14px;box-sizing:border-box;">';

    UI.showModal('Tag detected location', html, {
      footer: '<button class="btn btn-outline" onclick="UI.closeModal()">Cancel</button>'
        + ' <button class="btn btn-primary" onclick="TrackingPage._saveTag(\'' + id + '\')">Save</button>'
    });
  },

  _saveTag: function(id) {
    var jobId    = (document.getElementById('tag-job')    || {}).value || null;
    var clientId = (document.getElementById('tag-client') || {}).value || null;
    var label    = ((document.getElementById('tag-label') || {}).value || '').trim() || null;
    if (!jobId && !clientId && !label) {
      UI.toast('Pick something or add a label', 'error');
      return;
    }
    SupabaseDB.client.from('detected_locations').update({
      status:    'tagged',
      job_id:    jobId,
      client_id: clientId,
      label:     label
    }).eq('id', id).then(function(res) {
      if (res.error) UI.toast('Save failed: ' + res.error.message, 'error');
      else {
        UI.toast('Tagged ✓');
        UI.closeModal();
        TrackingPage.refresh();
      }
    });
  },

  _markYard:  function(id) { TrackingPage._setStatus(id, 'yard'); },
  _ignore:    function(id) { TrackingPage._setStatus(id, 'ignored'); },
  _reset:     function(id) { TrackingPage._setStatus(id, 'pending', { job_id: null, client_id: null, label: null }); },

  _setStatus: function(id, status, extra) {
    var payload = { status: status };
    if (extra) Object.keys(extra).forEach(function(k){ payload[k] = extra[k]; });
    SupabaseDB.client.from('detected_locations').update(payload).eq('id', id).then(function(res) {
      if (res.error) UI.toast('Update failed: ' + res.error.message, 'error');
      else {
        UI.toast('Updated ✓');
        TrackingPage.refresh();
      }
    });
  },

  _delete: function(id) {
    if (!confirm('Delete this detected location? Ping history is kept.')) return;
    SupabaseDB.client.from('detected_locations').delete().eq('id', id).then(function(res) {
      if (res.error) UI.toast('Delete failed: ' + res.error.message, 'error');
      else {
        UI.toast('Deleted ✓');
        TrackingPage.refresh();
      }
    });
  }
};
