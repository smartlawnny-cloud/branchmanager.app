/**
 * Branch Manager — Call Center
 * Dial pad + two-way SMS threads without ever opening Dialpad.
 */
var CallCenter = {
  _number: '',
  _clientId: null,
  _clientName: null,
  _activeThread: null,   // { phone, clientId, name }
  _activeTab: 'threads', // 'threads' | 'activity'

  render: function() {
    var configured = typeof Dialpad !== 'undefined' && Dialpad.isConfigured();

    var html = '<div style="max-width:1100px;margin:0 auto;">';
    html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">'
      + '<h2 style="font-size:22px;font-weight:700;margin:0;">📞 Call Center</h2>'
      + (configured
        ? '<span style="font-size:12px;background:#e8f5e9;color:#2e7d32;padding:3px 10px;border-radius:12px;font-weight:600;">● Live via Dialpad</span>'
        : '<span style="font-size:12px;background:#fff3e0;color:#e65100;padding:3px 10px;border-radius:12px;font-weight:600;">⚠ Dialpad not configured</span>')
      + '</div>';

    html += '<div style="display:grid;grid-template-columns:300px 1fr;gap:16px;align-items:start;">';

    // ── LEFT: Dial Pad ──────────────────────────────────────
    html += '<div>';

    // Client search
    html += '<div style="position:relative;margin-bottom:10px;">'
      + '<input type="text" id="cc-search" placeholder="Search clients…" autocomplete="off"'
      + '  onkeyup="CallCenter._onSearch(this.value)"'
      + '  style="width:100%;padding:9px 12px;border:2px solid var(--border);border-radius:9px;font-size:13px;box-sizing:border-box;background:var(--bg);color:var(--text);">'
      + '<div id="cc-search-results" style="display:none;position:absolute;left:0;right:0;z-index:10;background:var(--bg);border:1px solid var(--border);border-radius:8px;margin-top:2px;max-height:180px;overflow-y:auto;box-shadow:0 4px 16px rgba(0,0,0,.12);"></div>'
      + '</div>';

    // Number display
    html += '<div style="background:var(--surface);border:1.5px solid var(--border);border-radius:12px;padding:12px 16px;margin-bottom:10px;">'
      + '<div id="cc-client-label" style="font-size:11px;color:var(--accent);min-height:14px;margin-bottom:2px;font-weight:700;letter-spacing:.3px;"></div>'
      + '<div style="display:flex;align-items:center;gap:6px;">'
      + '<div id="cc-display" style="flex:1;font-size:24px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:1px;min-height:32px;color:var(--text);">—</div>'
      + '<button onclick="CallCenter._backspace()" title="Backspace"'
      + ' style="background:none;border:none;font-size:18px;cursor:pointer;padding:4px;color:var(--text-light);line-height:1;">⌫</button>'
      + '</div>'
      + '<input type="tel" id="cc-raw-input" placeholder="or type a number…" autocomplete="off"'
      + '  oninput="CallCenter._onRawInput(this.value)"'
      + '  style="width:100%;margin-top:6px;padding:7px 10px;border:1px solid var(--border);border-radius:7px;font-size:14px;box-sizing:border-box;background:var(--bg);color:var(--text);">'
      + '</div>';

    // Dial pad
    var keys = ['1','2','3','4','5','6','7','8','9','*','0','#'];
    html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px;">';
    keys.forEach(function(k) {
      html += '<button onclick="CallCenter._press(\'' + k + '\')"'
        + ' style="padding:13px 0;font-size:18px;font-weight:600;background:var(--surface);border:1px solid var(--border);border-radius:9px;cursor:pointer;"'
        + ' onmousedown="this.style.background=\'var(--border)\'" onmouseup="this.style.background=\'var(--surface)\'">'
        + k + '</button>';
    });
    html += '</div>';

    // Call / Text buttons
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:6px;">'
      + '<button onclick="CallCenter._doCall()" style="padding:12px;background:#1a7a3c;color:#fff;border:none;border-radius:9px;font-size:14px;font-weight:700;cursor:pointer;">📞 Call</button>'
      + '<button onclick="CallCenter._doText()" style="padding:12px;background:var(--green-dark);color:#fff;border:none;border-radius:9px;font-size:14px;font-weight:700;cursor:pointer;">💬 Text</button>'
      + '</div>'
      + '<button onclick="CallCenter._clear()" style="width:100%;padding:8px;background:none;border:1px solid var(--border);border-radius:7px;font-size:12px;color:var(--text-light);cursor:pointer;">Clear</button>';

    html += '</div>'; // end left col

    // ── RIGHT: Threads / Activity ───────────────────────────
    html += '<div style="border:1.5px solid var(--border);border-radius:12px;overflow:hidden;min-height:520px;display:flex;flex-direction:column;">';

    // Tab bar
    html += '<div style="display:flex;border-bottom:1px solid var(--border);background:var(--surface);">'
      + '<button id="cc-tab-threads" onclick="CallCenter._switchTab(\'threads\')"'
      + ' style="flex:1;padding:11px 0;font-size:13px;font-weight:600;border:none;cursor:pointer;background:' + (CallCenter._activeTab==='threads'?'var(--bg)':'var(--surface)') + ';color:' + (CallCenter._activeTab==='threads'?'var(--accent)':'var(--text-light)') + ';border-bottom:2px solid ' + (CallCenter._activeTab==='threads'?'var(--accent)':'transparent') + ';">💬 Messages</button>'
      + '<button id="cc-tab-activity" onclick="CallCenter._switchTab(\'activity\')"'
      + ' style="flex:1;padding:11px 0;font-size:13px;font-weight:600;border:none;cursor:pointer;background:' + (CallCenter._activeTab==='activity'?'var(--bg)':'var(--surface)') + ';color:' + (CallCenter._activeTab==='activity'?'var(--accent)':'var(--text-light)') + ';border-bottom:2px solid ' + (CallCenter._activeTab==='activity'?'var(--accent)':'transparent') + ';">📋 Activity</button>'
      + '</div>';

    // Panel content
    html += '<div id="cc-panel" style="flex:1;overflow-y:auto;">'
      + '<div style="text-align:center;padding:40px;color:var(--text-light);font-size:13px;">Loading…</div>'
      + '</div>';

    // Thread reply box (hidden until a thread is open)
    html += '<div id="cc-reply-box" style="display:none;padding:10px;border-top:1px solid var(--border);background:var(--surface);">'
      + '<div style="display:flex;gap:8px;align-items:flex-end;">'
      + '<textarea id="cc-reply-input" rows="2" placeholder="Type a message…"'
      + ' onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();CallCenter._sendReply();}"'
      + ' style="flex:1;padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;resize:none;font-family:inherit;background:var(--bg);color:var(--text);"></textarea>'
      + '<button onclick="CallCenter._sendReply()" style="padding:8px 18px;background:var(--green-dark);color:#fff;border:none;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap;">Send</button>'
      + '</div>'
      + '<div style="font-size:11px;color:var(--text-light);margin-top:4px;padding-left:2px;" id="cc-reply-to-label"></div>'
      + '</div>';

    html += '</div>'; // end right panel
    html += '</div></div>'; // end grid + outer

    setTimeout(function() {
      if (typeof Dialpad !== 'undefined') Dialpad.init();
      CallCenter._loadPanel();
      var inp = document.getElementById('cc-raw-input');
      if (inp) inp.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') CallCenter._doCall();
        if (e.key === 'Escape') CallCenter._clear();
      });
    }, 0);

    return html;
  },

  // ── Tab switching ──────────────────────────────────────────

  _switchTab: function(tab) {
    CallCenter._activeTab = tab;
    CallCenter._activeThread = null;
    ['threads','activity'].forEach(function(t) {
      var btn = document.getElementById('cc-tab-' + t);
      if (!btn) return;
      var active = t === tab;
      btn.style.background = active ? 'var(--bg)' : 'var(--surface)';
      btn.style.color = active ? 'var(--accent)' : 'var(--text-light)';
      btn.style.borderBottom = '2px solid ' + (active ? 'var(--accent)' : 'transparent');
    });
    var rb = document.getElementById('cc-reply-box');
    if (rb) rb.style.display = 'none';
    CallCenter._loadPanel();
  },

  _loadPanel: function() {
    if (CallCenter._activeTab === 'threads') {
      CallCenter._loadThreads();
    } else {
      CallCenter._loadActivity();
    }
  },

  // ── Dial pad ────────────────────────────────────────────────

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
    var d = CallCenter._number.replace(/\D/g, '');
    var formatted = CallCenter._number;
    if (d.length === 10) formatted = '(' + d.slice(0,3) + ') ' + d.slice(3,6) + '-' + d.slice(6);
    else if (d.length === 11 && d[0] === '1') formatted = '+1 (' + d.slice(1,4) + ') ' + d.slice(4,7) + '-' + d.slice(7);
    disp.textContent = formatted;
  },

  // ── Client search ───────────────────────────────────────────

  _onSearch: function(q) {
    var res = document.getElementById('cc-search-results');
    if (!res) return;
    q = q.trim().toLowerCase();
    if (!q) { res.style.display = 'none'; res.innerHTML = ''; return; }

    var clients = (typeof ClientsPage !== 'undefined' && ClientsPage._cache) ? ClientsPage._cache : [];
    var matches = clients.filter(function(c) {
      return (c.name || '').toLowerCase().includes(q) && c.phone;
    }).slice(0, 8);

    if (!matches.length) {
      res.innerHTML = '<div style="padding:10px 14px;color:var(--text-light);font-size:13px;">No clients found</div>';
    } else {
      res.innerHTML = matches.map(function(c) {
        var safeName  = (c.name  || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        var safePhone = (c.phone || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        return '<div onclick="CallCenter._selectClient(\'' + (c.id||'') + '\',\'' + safeName + '\',\'' + safePhone + '\')"'
          + ' style="padding:9px 14px;cursor:pointer;border-bottom:1px solid var(--border);font-size:13px;"'
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

  // ── Call / Text actions ─────────────────────────────────────

  _doCall: function() {
    var num = CallCenter._number.replace(/\D/g, '');
    if (!num) { UI.toast('Enter a phone number first', 'error'); return; }
    if (typeof Dialpad === 'undefined') { window.open('tel:' + num); return; }
    Dialpad.call(num, CallCenter._clientId, CallCenter._clientName);
  },

  _doText: function() {
    var num = CallCenter._number.replace(/\D/g, '');
    if (!num) { UI.toast('Enter a phone number first', 'error'); return; }
    // Open the thread for this number directly
    CallCenter._activeTab = 'threads';
    var thr = { phone: num, clientId: CallCenter._clientId, name: CallCenter._clientName || CallCenter._fmtPhone(num) };
    CallCenter._switchTab('threads');
    CallCenter._openThread(thr);
  },

  // ── SMS Threads ─────────────────────────────────────────────

  _loadThreads: async function() {
    var el = document.getElementById('cc-panel');
    if (!el) return;

    var sb = (typeof SupabaseDB !== 'undefined' && SupabaseDB.client) ? SupabaseDB.client : null;
    if (!sb) {
      el.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-light);font-size:13px;">Sign in to view message threads.</div>';
      return;
    }

    try {
      var { data, error } = await sb.from('communications')
        .select('id,client_id,channel,direction,body,from_number,to_number,created_at,metadata')
        .eq('channel', 'sms')
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) throw error;

      // Group by the "other" phone number
      var threadMap = {};
      (data || []).forEach(function(row) {
        var phone = (row.direction === 'inbound' ? row.from_number : row.to_number) || '';
        phone = phone.replace(/\D/g, '');
        if (!phone) return;
        if (!threadMap[phone]) {
          threadMap[phone] = { phone: phone, clientId: row.client_id, msgs: [], lastTs: row.created_at };
        }
        threadMap[phone].msgs.push(row);
        if (row.created_at > threadMap[phone].lastTs) threadMap[phone].lastTs = row.created_at;
      });

      var threads = Object.values(threadMap).sort(function(a, b) {
        return b.lastTs > a.lastTs ? 1 : -1;
      });

      if (!threads.length) {
        el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-light);font-size:13px;">No messages yet.<br>Use the dial pad to send a text.</div>';
        return;
      }

      // Resolve client names from cache
      var clients = (typeof ClientsPage !== 'undefined' && ClientsPage._cache) ? ClientsPage._cache : [];
      var clientMap = {};
      clients.forEach(function(c) { if (c.id) clientMap[c.id] = c.name; });

      el.innerHTML = threads.map(function(thr) {
        var last = thr.msgs[0]; // already desc order
        var name = (thr.clientId && clientMap[thr.clientId]) || CallCenter._fmtPhone(thr.phone);
        var preview = (last.body || '').slice(0, 60) || '—';
        var ts = UI.dateRelative(thr.lastTs);
        var isIn = last.direction === 'inbound';
        var unread = thr.msgs.filter(function(m) { return m.direction === 'inbound'; }).length;
        var safePhone = thr.phone.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        var safeName  = name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        var safeId    = (thr.clientId || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'");

        return '<div onclick="CallCenter._openThread({phone:\'' + safePhone + '\',clientId:\'' + safeId + '\',name:\'' + safeName + '\'})"'
          + ' style="display:flex;gap:12px;padding:13px 16px;border-bottom:1px solid var(--border);cursor:pointer;align-items:center;"'
          + ' onmouseover="this.style.background=\'var(--surface)\'" onmouseout="this.style.background=\'\';">'
          + '<div style="flex-shrink:0;width:40px;height:40px;background:var(--green-dark);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;color:#fff;font-weight:700;">'
          + name.charAt(0).toUpperCase() + '</div>'
          + '<div style="flex:1;min-width:0;">'
          + '<div style="display:flex;justify-content:space-between;align-items:baseline;">'
          + '<span style="font-weight:' + (isIn?'700':'600') + ';font-size:14px;">' + name + '</span>'
          + '<span style="font-size:11px;color:var(--text-light);">' + ts + '</span>'
          + '</div>'
          + '<div style="font-size:12px;color:var(--text-light);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'
          + (isIn ? '' : '<span style="color:var(--text-light);">You: </span>') + preview + '</div>'
          + '</div>'
          + (unread > 0 && isIn ? '<div style="flex-shrink:0;width:20px;height:20px;background:var(--accent);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff;font-weight:700;">' + Math.min(unread,9) + '</div>' : '')
          + '</div>';
      }).join('');
    } catch(e) {
      console.warn('CallCenter thread load failed:', e);
      el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-light);font-size:13px;">Failed to load messages.</div>';
    }
  },

  _openThread: async function(thr) {
    CallCenter._activeThread = thr;

    // Populate dial pad with this contact's number
    CallCenter._number = thr.phone;
    CallCenter._clientId = thr.clientId || null;
    CallCenter._clientName = thr.name || null;
    CallCenter._refreshDisplay();
    var lbl = document.getElementById('cc-client-label');
    if (lbl) lbl.textContent = thr.name || '';
    var inp = document.getElementById('cc-raw-input');
    if (inp) inp.value = CallCenter._fmtPhone(thr.phone);

    // Show reply box
    var rb = document.getElementById('cc-reply-box');
    if (rb) rb.style.display = 'block';
    var rtl = document.getElementById('cc-reply-to-label');
    if (rtl) rtl.textContent = 'To: ' + (thr.name || CallCenter._fmtPhone(thr.phone)) + ' · ' + CallCenter._fmtPhone(thr.phone) + ' · Enter to send';

    var el = document.getElementById('cc-panel');
    if (!el) return;
    el.innerHTML = '<div style="padding:14px 16px;border-bottom:1px solid var(--border);background:var(--surface);display:flex;align-items:center;gap:10px;">'
      + '<button onclick="CallCenter._switchTab(\'threads\')" style="background:none;border:none;cursor:pointer;font-size:16px;color:var(--text-light);padding:0;line-height:1;">‹</button>'
      + '<div style="font-weight:700;font-size:14px;">' + (thr.name || CallCenter._fmtPhone(thr.phone)) + '</div>'
      + '<div style="font-size:12px;color:var(--text-light);">' + CallCenter._fmtPhone(thr.phone) + '</div>'
      + '</div>'
      + '<div id="cc-thread-msgs" style="padding:12px 16px;display:flex;flex-direction:column;gap:8px;min-height:200px;">'
      + '<div style="text-align:center;font-size:12px;color:var(--text-light);">Loading…</div>'
      + '</div>';

    // Load thread messages
    var sb = (typeof SupabaseDB !== 'undefined' && SupabaseDB.client) ? SupabaseDB.client : null;
    if (!sb) return;

    try {
      var { data, error } = await sb.from('communications')
        .select('id,direction,body,from_number,to_number,created_at,status')
        .eq('channel', 'sms')
        .or('from_number.eq.+' + thr.phone + ',to_number.eq.+' + thr.phone + ',from_number.eq.' + thr.phone + ',to_number.eq.' + thr.phone)
        .order('created_at', { ascending: true })
        .limit(100);

      if (error) throw error;
      var msgs = data || [];

      var msgsEl = document.getElementById('cc-thread-msgs');
      if (!msgsEl) return;

      if (!msgs.length) {
        msgsEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-light);font-size:13px;">No messages yet — start the conversation!</div>';
        return;
      }

      msgsEl.innerHTML = msgs.map(function(m) {
        var out = m.direction === 'outbound';
        var body = m.body || '';
        var ts = m.created_at ? new Date(m.created_at).toLocaleTimeString('en-US', {hour:'numeric',minute:'2-digit'}) + ' · ' + new Date(m.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '';
        return '<div style="display:flex;flex-direction:column;align-items:' + (out?'flex-end':'flex-start') + ';">'
          + '<div style="max-width:75%;padding:9px 13px;border-radius:' + (out?'14px 14px 4px 14px':'14px 14px 14px 4px') + ';background:' + (out?'var(--green-dark)':'var(--surface)') + ';color:' + (out?'#fff':'var(--text)') + ';font-size:13px;line-height:1.4;border:' + (out?'none':'1px solid var(--border)') + ';">'
          + body
          + '</div>'
          + '<div style="font-size:10px;color:var(--text-light);margin-top:2px;padding:0 2px;">' + ts + '</div>'
          + '</div>';
      }).join('');

      // Scroll to bottom
      el.scrollTop = el.scrollHeight;
      setTimeout(function() { el.scrollTop = el.scrollHeight; }, 50);

      // Focus reply input
      var ri = document.getElementById('cc-reply-input');
      if (ri) ri.focus();
    } catch(e) {
      console.warn('Thread detail load failed:', e);
    }
  },

  // ── Send reply ──────────────────────────────────────────────

  _sendReply: async function() {
    var thr = CallCenter._activeThread;
    if (!thr) return;

    var inp = document.getElementById('cc-reply-input');
    var msg = inp ? inp.value.trim() : '';
    if (!msg) return;

    if (inp) inp.value = '';
    if (inp) inp.disabled = true;

    // Optimistic: append message to thread immediately
    var msgsEl = document.getElementById('cc-thread-msgs');
    if (msgsEl) {
      var div = document.createElement('div');
      div.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;';
      div.innerHTML = '<div style="max-width:75%;padding:9px 13px;border-radius:14px 14px 4px 14px;background:var(--green-dark);color:#fff;font-size:13px;line-height:1.4;">' + msg + '</div>'
        + '<div style="font-size:10px;color:var(--text-light);margin-top:2px;padding:0 2px;">Sending…</div>';
      msgsEl.appendChild(div);
      var panel = document.getElementById('cc-panel');
      if (panel) panel.scrollTop = panel.scrollHeight;
    }

    // Send via Dialpad
    var sent = false;
    if (typeof Dialpad !== 'undefined') {
      var result = await Dialpad.sendSMS(thr.phone, msg, thr.clientId);
      sent = result && result.success;
    }

    // Also persist to Supabase directly (in case Dialpad webhook doesn't fire for outbound)
    var sb = (typeof SupabaseDB !== 'undefined' && SupabaseDB.client) ? SupabaseDB.client : null;
    if (sb) {
      await sb.from('communications').insert({
        client_id:   thr.clientId || null,
        channel:     'sms',
        direction:   'outbound',
        status:      sent ? 'sent' : 'sent_fallback',
        body:        msg,
        to_number:   '+' + thr.phone,
        from_number: null,
        dialpad_id:  'bm-out-' + Date.now(),
        metadata:    { sent_from: 'callcenter', method: sent ? 'dialpad' : 'fallback' }
      }).catch(function(e) { console.warn('comms insert failed:', e); });
    }

    if (inp) inp.disabled = false;
    if (inp) inp.focus();

    // Update the optimistic "Sending…" label
    if (msgsEl) {
      var labels = msgsEl.querySelectorAll('div[style*="flex-end"]');
      var last = labels[labels.length - 1];
      if (last) {
        var ts = new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
        var tsEl = last.querySelector('div:last-child');
        if (tsEl) tsEl.textContent = ts + (sent ? '' : ' · fallback');
      }
    }
  },

  // ── Activity feed ───────────────────────────────────────────

  _loadActivity: async function() {
    var el = document.getElementById('cc-panel');
    if (!el) return;

    var sb = (typeof SupabaseDB !== 'undefined' && SupabaseDB.client) ? SupabaseDB.client : null;
    if (!sb) { el.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-light);font-size:13px;">Sign in to view activity.</div>'; return; }

    try {
      var { data, error } = await sb.from('communications')
        .select('id,client_id,channel,direction,body,from_number,to_number,status,created_at,metadata')
        .order('created_at', { ascending: false })
        .limit(40);

      if (error) throw error;
      var comms = data || [];

      if (!comms.length) {
        el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-light);font-size:13px;">No activity yet.</div>';
        return;
      }

      var clients = (typeof ClientsPage !== 'undefined' && ClientsPage._cache) ? ClientsPage._cache : [];
      var clientMap = {};
      clients.forEach(function(c) { if (c.id) clientMap[c.id] = c; });

      el.innerHTML = comms.map(function(c) {
        var isIn = c.direction === 'inbound';
        var icon = c.channel === 'call' ? '📞' : c.channel === 'sms' ? '💬' : c.channel === 'voicemail' ? '📱' : '📧';
        var dirColor = isIn ? '#1565c0' : '#2e7d32';
        var cl = c.client_id ? clientMap[c.client_id] : null;
        var who = (cl && cl.name) || (isIn ? CallCenter._fmtPhone(c.from_number) : CallCenter._fmtPhone(c.to_number)) || 'Unknown';
        var phone = (isIn ? c.from_number : c.to_number) || '';
        var body = c.body || '';
        var ts = UI.dateRelative(c.created_at);
        var safePhone = phone.replace(/\D/g,'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        var safeWho   = who.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        var safeId    = (c.client_id||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");

        var clickable = safePhone ? 'onclick="CallCenter._selectClient(\'' + safeId + '\',\'' + safeWho + '\',\'' + safePhone + '\')"' : '';
        return '<div ' + clickable + ' style="display:flex;gap:12px;padding:11px 16px;border-bottom:1px solid var(--border);' + (safePhone?'cursor:pointer;':'') + '"'
          + (safePhone ? ' onmouseover="this.style.background=\'var(--surface)\'" onmouseout="this.style.background=\'\';"' : '') + '>'
          + '<div style="flex-shrink:0;width:34px;height:34px;background:var(--surface);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;">' + icon + '</div>'
          + '<div style="flex:1;min-width:0;">'
          + '<div style="display:flex;justify-content:space-between;align-items:baseline;">'
          + '<span style="font-weight:600;font-size:13px;">' + who + '</span>'
          + '<span style="font-size:11px;color:var(--text-light);">' + ts + '</span>'
          + '</div>'
          + '<div style="font-size:11px;color:' + dirColor + ';font-weight:600;">' + (isIn?'← In':'→ Out') + (phone ? ' · ' + CallCenter._fmtPhone(phone) : '') + '</div>'
          + (body ? '<div style="font-size:12px;color:var(--text-light);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + body + '</div>' : '')
          + '</div>'
          + '</div>';
      }).join('');
    } catch(e) {
      el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-light);font-size:13px;">Failed to load activity.</div>';
    }
  },

  _fmtPhone: function(p) {
    var d = (p || '').replace(/\D/g,'');
    if (d.length === 10) return '(' + d.slice(0,3) + ') ' + d.slice(3,6) + '-' + d.slice(6);
    if (d.length === 11 && d[0]==='1') return '+1 (' + d.slice(1,4) + ') ' + d.slice(4,7) + '-' + d.slice(7);
    return p || '';
  }
};
