/**
 * Branch Manager — Call Center
 * Click-to-call and SMS without ever opening Dialpad.
 * Uses Dialpad.call() / Dialpad.sendSMS() for actual delivery.
 */
var CallCenter = {
  _number: '',
  _clientId: null,
  _clientName: null,
  _recentComms: [],

  render: function() {
    var configured = typeof Dialpad !== 'undefined' && Dialpad.isConfigured();

    var html = '<div style="max-width:1000px;margin:0 auto;">';
    html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">'
      + '<h2 style="font-size:22px;font-weight:700;margin:0;">📞 Call Center</h2>'
      + (configured
        ? '<span style="font-size:12px;background:#e8f5e9;color:#2e7d32;padding:3px 10px;border-radius:12px;font-weight:600;">● Live via Dialpad</span>'
        : '<span style="font-size:12px;background:#fff3e0;color:#e65100;padding:3px 10px;border-radius:12px;font-weight:600;">⚠ Dialpad key not set — using phone fallback</span>')
      + '</div>';

    html += '<div style="display:grid;grid-template-columns:320px 1fr;gap:20px;align-items:start;">';

    // ── LEFT: Dial Pad ──────────────────────────────────────
    html += '<div>';

    // Client search
    html += '<div style="margin-bottom:12px;">'
      + '<input type="text" id="cc-search" placeholder="Search clients by name…" autocomplete="off"'
      + '  onkeyup="CallCenter._onSearch(this.value)"'
      + '  style="width:100%;padding:10px 14px;border:2px solid var(--border);border-radius:10px;font-size:14px;box-sizing:border-box;background:var(--bg);color:var(--text);">'
      + '<div id="cc-search-results" style="display:none;background:var(--bg);border:1px solid var(--border);border-radius:8px;margin-top:4px;max-height:200px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,.08);"></div>'
      + '</div>';

    // Number display
    html += '<div style="background:var(--bg);border:2px solid var(--border);border-radius:12px;padding:16px 20px;margin-bottom:12px;">'
      + '<div id="cc-client-label" style="font-size:12px;color:var(--text-light);min-height:16px;margin-bottom:4px;font-weight:600;"></div>'
      + '<div style="display:flex;align-items:center;gap:8px;">'
      + '<div id="cc-display" style="flex:1;font-size:26px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:2px;min-height:36px;color:var(--text);" onclick="document.getElementById(\'cc-raw-input\').focus()">—</div>'
      + '<button onclick="CallCenter._backspace()" style="background:none;border:none;font-size:20px;cursor:pointer;padding:4px;color:var(--text-light);line-height:1;" title="Backspace">⌫</button>'
      + '</div>'
      + '<input type="tel" id="cc-raw-input" placeholder="Type a number…" autocomplete="off"'
      + '  oninput="CallCenter._onRawInput(this.value)"'
      + '  style="width:100%;margin-top:8px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:15px;box-sizing:border-box;background:var(--surface);color:var(--text);">'
      + '</div>';

    // Dial pad
    var keys = ['1','2','3','4','5','6','7','8','9','*','0','#'];
    html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;">';
    keys.forEach(function(k) {
      html += '<button onclick="CallCenter._press(\'' + k + '\')"'
        + ' style="padding:16px 0;font-size:20px;font-weight:600;background:var(--surface);border:1px solid var(--border);border-radius:10px;cursor:pointer;transition:background .1s;"'
        + ' onmousedown="this.style.background=\'var(--border)\'" onmouseup="this.style.background=\'var(--surface)\'">'
        + k + '</button>';
    });
    html += '</div>';

    // Call / Text / Clear buttons
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">'
      + '<button onclick="CallCenter._doCall()" style="padding:14px;background:#1a7a3c;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;">📞 Call</button>'
      + '<button onclick="CallCenter._doText()" style="padding:14px;background:var(--green-dark);color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;">💬 Text</button>'
      + '</div>'
      + '<button onclick="CallCenter._clear()" style="width:100%;margin-top:8px;padding:10px;background:none;border:1px solid var(--border);border-radius:8px;font-size:13px;color:var(--text-light);cursor:pointer;">Clear</button>';

    html += '</div>'; // end left col

    // ── RIGHT: Recent Activity ──────────────────────────────
    html += '<div>'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">'
      + '<h3 style="font-size:15px;font-weight:700;margin:0;">Recent Activity</h3>'
      + '<button onclick="CallCenter._loadRecent(true)" style="background:none;border:none;font-size:12px;color:var(--accent);cursor:pointer;font-weight:600;">↻ Refresh</button>'
      + '</div>'
      + '<div id="cc-recent" style="display:flex;flex-direction:column;gap:0;">'
      + '<div style="text-align:center;padding:32px;color:var(--text-light);font-size:13px;">Loading…</div>'
      + '</div>'
      + '</div>';

    html += '</div></div>'; // end grid + outer

    setTimeout(function() {
      if (typeof Dialpad !== 'undefined') Dialpad.init();
      CallCenter._loadRecent(false);
      var inp = document.getElementById('cc-raw-input');
      if (inp) inp.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') CallCenter._doCall();
        if (e.key === 'Escape') CallCenter._clear();
      });
    }, 0);

    return html;
  },

  // ── Dial pad input ─────────────────────────────────────────

  _press: function(key) {
    CallCenter._number += key;
    CallCenter._refreshDisplay();
    var inp = document.getElementById('cc-raw-input');
    if (inp) inp.value = CallCenter._number;
  },

  _backspace: function() {
    CallCenter._number = CallCenter._number.slice(0, -1);
    CallCenter._refreshDisplay();
    var inp = document.getElementById('cc-raw-input');
    if (inp) inp.value = CallCenter._number;
  },

  _onRawInput: function(val) {
    CallCenter._number = val.replace(/[^\d\+\*\#]/g, '');
    CallCenter._refreshDisplay();
    CallCenter._clientId = null;
    CallCenter._clientName = null;
    var lbl = document.getElementById('cc-client-label');
    if (lbl) lbl.textContent = '';
  },

  _clear: function() {
    CallCenter._number = '';
    CallCenter._clientId = null;
    CallCenter._clientName = null;
    var disp = document.getElementById('cc-display');
    if (disp) disp.textContent = '—';
    var inp = document.getElementById('cc-raw-input');
    if (inp) inp.value = '';
    var lbl = document.getElementById('cc-client-label');
    if (lbl) lbl.textContent = '';
    var srch = document.getElementById('cc-search');
    if (srch) srch.value = '';
    var res = document.getElementById('cc-search-results');
    if (res) { res.style.display = 'none'; res.innerHTML = ''; }
  },

  _refreshDisplay: function() {
    var disp = document.getElementById('cc-display');
    if (!disp) return;
    if (!CallCenter._number) { disp.textContent = '—'; return; }
    // Format for display: (XXX) XXX-XXXX for 10-digit numbers
    var d = CallCenter._number.replace(/\D/g, '');
    var formatted = CallCenter._number;
    if (d.length === 10) formatted = '(' + d.slice(0,3) + ') ' + d.slice(3,6) + '-' + d.slice(6);
    else if (d.length === 11 && d[0] === '1') formatted = '+1 (' + d.slice(1,4) + ') ' + d.slice(4,7) + '-' + d.slice(7);
    disp.textContent = formatted;
  },

  // ── Client search ──────────────────────────────────────────

  _onSearch: function(q) {
    var res = document.getElementById('cc-search-results');
    if (!res) return;
    q = q.trim().toLowerCase();
    if (!q) { res.style.display = 'none'; res.innerHTML = ''; return; }

    // Pull from clientsCache or Supabase clients table
    var clients = [];
    if (typeof ClientsPage !== 'undefined' && ClientsPage._cache && ClientsPage._cache.length) {
      clients = ClientsPage._cache;
    }

    var matches = clients.filter(function(c) {
      return (c.name || '').toLowerCase().includes(q) && c.phone;
    }).slice(0, 8);

    if (!matches.length) {
      res.innerHTML = '<div style="padding:10px 14px;color:var(--text-light);font-size:13px;">No clients found</div>';
    } else {
      res.innerHTML = matches.map(function(c) {
        return '<div onclick="CallCenter._selectClient(\'' + (c.id || '') + '\',\'' + (c.name || '').replace(/'/g,'') + '\',\'' + (c.phone || '').replace(/'/g,'') + '\')"'
          + ' style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);font-size:13px;"'
          + ' onmouseover="this.style.background=\'var(--surface)\'" onmouseout="this.style.background=\'\';">'
          + '<div style="font-weight:600;">' + (c.name || '') + '</div>'
          + '<div style="color:var(--text-light);font-size:12px;">' + (c.phone || '') + '</div>'
          + '</div>';
      }).join('');
    }
    res.style.display = 'block';
  },

  _selectClient: function(id, name, phone) {
    CallCenter._clientId   = id || null;
    CallCenter._clientName = name || null;
    CallCenter._number     = phone.replace(/\D/g, '');

    var inp = document.getElementById('cc-raw-input');
    if (inp) inp.value = phone;
    CallCenter._refreshDisplay();

    var lbl = document.getElementById('cc-client-label');
    if (lbl) lbl.textContent = name;

    var srch = document.getElementById('cc-search');
    if (srch) srch.value = '';
    var res = document.getElementById('cc-search-results');
    if (res) { res.style.display = 'none'; res.innerHTML = ''; }
  },

  // ── Actions ────────────────────────────────────────────────

  _doCall: function() {
    var num = CallCenter._number.replace(/\D/g, '');
    if (!num) { UI.toast('Enter a phone number first', 'error'); return; }
    if (typeof Dialpad === 'undefined') { window.open('tel:' + num); return; }
    Dialpad.call(num, CallCenter._clientId, CallCenter._clientName);
  },

  _doText: function() {
    var num = CallCenter._number.replace(/\D/g, '');
    if (!num) { UI.toast('Enter a phone number first', 'error'); return; }
    if (typeof Dialpad === 'undefined') { window.open('sms:' + num); return; }
    Dialpad.showTextModal(CallCenter._clientId, CallCenter._clientName || num, num);
  },

  // ── Recent activity feed ───────────────────────────────────

  _loadRecent: async function(showToast) {
    var el = document.getElementById('cc-recent');
    if (!el) return;

    try {
      var sb = (typeof SupabaseDB !== 'undefined' && SupabaseDB.client) ? SupabaseDB.client : null;
      if (!sb) { el.innerHTML = CallCenter._recentHtml([]); return; }

      var q = sb.from('communications')
        .select('id,client_id,channel,direction,status,body,metadata,created_at')
        .in('channel', ['call', 'sms', 'email', 'voice'])
        .order('created_at', { ascending: false })
        .limit(30);

      var { data, error } = await q;
      if (error) throw error;
      CallCenter._recentComms = data || [];
      el.innerHTML = CallCenter._recentHtml(CallCenter._recentComms);
      if (showToast) UI.toast('Refreshed');
    } catch(e) {
      console.warn('CallCenter recent load failed:', e);
      el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-light);font-size:13px;">Could not load recent activity.</div>';
    }
  },

  _recentHtml: function(comms) {
    if (!comms || !comms.length) {
      return '<div style="padding:32px;text-align:center;color:var(--text-light);font-size:13px;">No call or text history yet.<br>Make your first call above!</div>';
    }
    return comms.map(function(c) {
      var meta = c.metadata || {};
      var isIn  = c.direction === 'inbound';
      var icon  = c.channel === 'call' ? '📞' : c.channel === 'sms' ? '💬' : '📧';
      var dir   = isIn ? '← In' : '→ Out';
      var dirColor = isIn ? '#1565c0' : '#2e7d32';
      var who   = meta.from_name || meta.to_name || meta.to || (c.client_id ? 'Client' : 'Unknown');
      var body  = c.body || meta.text || '';
      var ts    = c.created_at ? UI.dateRelative(c.created_at) : '';
      var phone = meta.from || meta.to || '';

      return '<div style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);cursor:pointer;"'
        + ' onclick="' + (phone ? 'CallCenter._selectClient(\'' + (c.client_id||'') + '\',\'' + who.replace(/'/g,'') + '\',\'' + phone.replace(/\D/g,'') + '\')' : '') + '">'
        + '<div style="flex-shrink:0;width:36px;height:36px;background:var(--surface);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;">' + icon + '</div>'
        + '<div style="flex:1;min-width:0;">'
        + '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:4px;">'
        + '<span style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + who + '</span>'
        + '<span style="font-size:11px;color:var(--text-light);white-space:nowrap;">' + ts + '</span>'
        + '</div>'
        + '<div style="font-size:11px;color:' + dirColor + ';font-weight:600;">' + dir + (phone ? ' · ' + CallCenter._fmtPhone(phone) : '') + '</div>'
        + (body ? '<div style="font-size:12px;color:var(--text-light);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + body + '</div>' : '')
        + '</div>'
        + '</div>';
    }).join('');
  },

  _fmtPhone: function(p) {
    var d = (p || '').replace(/\D/g,'');
    if (d.length === 10) return '(' + d.slice(0,3) + ') ' + d.slice(3,6) + '-' + d.slice(6);
    if (d.length === 11 && d[0]==='1') return '+1 (' + d.slice(1,4) + ') ' + d.slice(4,7) + '-' + d.slice(7);
    return p;
  }
};
