/**
 * Branch Manager — Insurance Manager
 * Store company policies, request COIs, track certificate status.
 *
 * Data persisted to localStorage (no Supabase table needed — policy info
 * is a handful of records; cert requests link to job IDs stored locally).
 *
 * Keys:
 *   bm-ins-policies  → [ { id, type, carrier, policyNum, limit, expiry, notes } ]
 *   bm-ins-certs     → [ { id, jobId, jobTitle, clientName, holderName, holderAddr,
 *                           description, requested, received, sentToClient,
 *                           status, notes, additionalInsured, waiverSubrogation } ]
 *   bm-ins-agent     → { name, email, phone, agency }
 */
var InsurancePage = {
  _tab: 'certs',          // 'certs' | 'policies' | 'agent'

  // ── Storage helpers ───────────────────────────────────────────────────
  _getPolicies: function() { try { return JSON.parse(localStorage.getItem('bm-ins-policies') || '[]'); } catch(e) { return []; } },
  _savePolicies: function(d) { localStorage.setItem('bm-ins-policies', JSON.stringify(d)); },
  _getCerts: function() { try { return JSON.parse(localStorage.getItem('bm-ins-certs') || '[]'); } catch(e) { return []; } },
  _saveCerts: function(d) { localStorage.setItem('bm-ins-certs', JSON.stringify(d)); },
  _getAgent: function() { try { return JSON.parse(localStorage.getItem('bm-ins-agent') || '{}'); } catch(e) { return {}; } },
  _saveAgent: function(d) { localStorage.setItem('bm-ins-agent', JSON.stringify(d)); },
  _id: function() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 5); },

  // ── Render ────────────────────────────────────────────────────────────
  render: function() {
    var policies = InsurancePage._getPolicies();
    var certs = InsurancePage._getCerts();
    var agent = InsurancePage._getAgent();

    // Expiry warnings
    var now = Date.now();
    var expiring = policies.filter(function(p) {
      if (!p.expiry) return false;
      var d = new Date(p.expiry).getTime() - now;
      return d > 0 && d < 60 * 86400000; // within 60 days
    });
    var expired = policies.filter(function(p) {
      return p.expiry && new Date(p.expiry).getTime() < now;
    });

    var html = '<div style="max-width:900px;">';

    // Header
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px;">'
      + '<h2 style="margin:0;">🛡️ Insurance</h2>'
      + '<button onclick="InsurancePage._newCert()" style="background:var(--green-dark);color:#fff;border:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">+ Request COI</button>'
      + '</div>';

    // Alerts
    if (expired.length) {
      html += '<div style="background:#fdecea;border:1px solid #e57373;border-radius:8px;padding:12px 16px;margin-bottom:12px;font-size:13px;color:#c62828;">'
        + '⚠️ <strong>' + expired.length + ' policy' + (expired.length > 1 ? 'ies' : 'y') + ' EXPIRED:</strong> '
        + expired.map(function(p) { return p.type + ' (' + (p.carrier || '') + ')'; }).join(', ')
        + ' — update your policy info.</div>';
    }
    if (expiring.length) {
      html += '<div style="background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:12px 16px;margin-bottom:12px;font-size:13px;color:#e65100;">'
        + '⏳ <strong>' + expiring.length + ' policy expiring within 60 days:</strong> '
        + expiring.map(function(p) {
            var days = Math.ceil((new Date(p.expiry).getTime() - now) / 86400000);
            return p.type + ' (expires in ' + days + 'd)';
          }).join(', ')
        + '</div>';
    }

    // Tabs
    var tabs = [['certs','📄 Certificates (' + certs.length + ')'], ['policies','🗂️ Policies (' + policies.length + ')'], ['agent','👤 Agent']];
    html += '<div style="display:flex;gap:0;border-bottom:2px solid var(--border);margin-bottom:20px;">';
    tabs.forEach(function(t) {
      var active = InsurancePage._tab === t[0];
      html += '<button onclick="InsurancePage._tab=\'' + t[0] + '\';loadPage(\'insurance\')" style="padding:10px 18px;border:none;background:none;font-size:14px;font-weight:' + (active?'700':'500') + ';color:' + (active?'var(--green-dark)':'var(--text-light)') + ';border-bottom:2px solid ' + (active?'var(--green-dark)':'transparent') + ';margin-bottom:-2px;cursor:pointer;white-space:nowrap;">' + t[1] + '</button>';
    });
    html += '</div>';

    if (InsurancePage._tab === 'certs') html += InsurancePage._renderCerts(certs);
    else if (InsurancePage._tab === 'policies') html += InsurancePage._renderPolicies(policies);
    else html += InsurancePage._renderAgent(agent);

    html += '</div>';
    return html;
  },

  // ── Certificates tab ──────────────────────────────────────────────────
  _renderCerts: function(certs) {
    if (!certs.length) {
      return '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:48px;text-align:center;">'
        + '<div style="font-size:36px;margin-bottom:12px;">📄</div>'
        + '<h3 style="margin:0 0 8px;">No certificate requests yet</h3>'
        + '<p style="color:var(--text-light);font-size:14px;margin:0 0 20px;">When a client or job site requires proof of insurance, click "+ Request COI" to email your agent and track the certificate.</p>'
        + '<button onclick="InsurancePage._newCert()" style="background:var(--green-dark);color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">+ Request First COI</button>'
        + '</div>';
    }

    var statusOrder = { 'requested': 0, 'received': 1, 'sent': 2 };
    var sorted = certs.slice().sort(function(a, b) { return (statusOrder[a.status]||0) - (statusOrder[b.status]||0) || new Date(b.requested) - new Date(a.requested); });

    var html = '<div style="display:flex;flex-direction:column;gap:10px;">';
    sorted.forEach(function(c) {
      var statusColor = c.status === 'sent' ? '#2e7d32' : c.status === 'received' ? '#1565c0' : '#e65100';
      var statusLabel = c.status === 'sent' ? '✓ Sent to Client' : c.status === 'received' ? '📬 Received' : '📤 Requested';
      html += '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:16px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">'
        + '<div style="flex:1;min-width:200px;">'
        + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">'
        + '<span style="font-weight:700;font-size:15px;">' + UI.esc(c.holderName || c.clientName || 'Unknown') + '</span>'
        + '<span style="font-size:11px;font-weight:700;color:' + statusColor + ';background:' + statusColor + '18;padding:2px 8px;border-radius:20px;">' + statusLabel + '</span>'
        + (c.additionalInsured ? '<span style="font-size:11px;color:#1565c0;background:#e3f2fd;padding:2px 8px;border-radius:20px;">Additional Insured</span>' : '')
        + '</div>'
        + (c.jobTitle ? '<div style="font-size:13px;color:var(--text-light);margin-bottom:2px;">Job: ' + UI.esc(c.jobTitle) + '</div>' : '')
        + (c.holderAddr ? '<div style="font-size:13px;color:var(--text-light);margin-bottom:2px;">📍 ' + UI.esc(c.holderAddr) + '</div>' : '')
        + (c.description ? '<div style="font-size:13px;color:var(--text-light);">Work: ' + UI.esc(c.description) + '</div>' : '')
        + '</div>'
        + '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;">'
        + '<div style="font-size:11px;color:var(--text-light);">Requested ' + InsurancePage._fmtDate(c.requested) + '</div>'
        + '<div style="display:flex;gap:6px;">';

      if (c.status === 'requested') {
        html += '<button onclick="InsurancePage._markStatus(\'' + c.id + '\',\'received\')" style="background:#e3f2fd;color:#1565c0;border:none;padding:5px 10px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">📬 Mark Received</button>';
        html += '<button onclick="InsurancePage._resendRequest(\'' + c.id + '\')" title="Re-send email to agent" style="background:var(--bg);border:1px solid var(--border);padding:5px 10px;border-radius:6px;font-size:12px;cursor:pointer;">↻ Resend</button>';
      } else if (c.status === 'received') {
        html += '<button onclick="InsurancePage._markStatus(\'' + c.id + '\',\'sent\')" style="background:#e8f5e9;color:#2e7d32;border:none;padding:5px 10px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">✓ Mark Sent to Client</button>';
      }
      html += '<button onclick="InsurancePage._deleteCert(\'' + c.id + '\')" style="background:none;border:1px solid var(--border);padding:5px 8px;border-radius:6px;font-size:12px;color:var(--text-light);cursor:pointer;">✕</button>';
      html += '</div></div></div>';
    });
    html += '</div>';
    return html;
  },

  // ── Policies tab ──────────────────────────────────────────────────────
  _renderPolicies: function(policies) {
    var policyTypes = ['General Liability', 'Workers Compensation', 'Commercial Auto', 'Umbrella / Excess', 'Inland Marine / Equipment', 'Other'];
    var now = Date.now();

    var html = '<div style="margin-bottom:14px;display:flex;justify-content:flex-end;">'
      + '<button onclick="InsurancePage._showPolicyForm(null)" style="background:var(--green-dark);color:#fff;border:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">+ Add Policy</button>'
      + '</div>';

    if (!policies.length) {
      html += '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:40px;text-align:center;">'
        + '<div style="font-size:36px;margin-bottom:12px;">🗂️</div>'
        + '<h3 style="margin:0 0 8px;">No policies yet</h3>'
        + '<p style="color:var(--text-light);font-size:14px;margin:0 0 16px;">Add your GL, WC, and Auto policies so the info is instantly available when needed.</p>'
        + '<button onclick="InsurancePage._showPolicyForm(null)" style="background:var(--green-dark);color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">+ Add First Policy</button>'
        + '</div>';
      return html;
    }

    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">';
    policies.forEach(function(p) {
      var expDate = p.expiry ? new Date(p.expiry) : null;
      var daysLeft = expDate ? Math.ceil((expDate.getTime() - now) / 86400000) : null;
      var expiryColor = daysLeft === null ? 'var(--text-light)' : daysLeft < 0 ? '#c62828' : daysLeft < 60 ? '#e65100' : '#2e7d32';
      var expiryLabel = daysLeft === null ? '' : daysLeft < 0 ? '⚠ EXPIRED' : daysLeft < 60 ? '⏳ ' + daysLeft + 'd left' : '✓ ' + daysLeft + 'd left';

      html += '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:16px;">'
        + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">'
        + '<div>'
        + '<div style="font-weight:700;font-size:14px;margin-bottom:2px;">' + UI.esc(p.type || 'Policy') + '</div>'
        + '<div style="font-size:13px;color:var(--text-light);">' + UI.esc(p.carrier || 'Carrier not set') + '</div>'
        + '</div>'
        + (expiryLabel ? '<span style="font-size:11px;font-weight:700;color:' + expiryColor + ';">' + expiryLabel + '</span>' : '')
        + '</div>'
        + (p.policyNum ? '<div style="font-size:12px;margin-bottom:4px;"><span style="color:var(--text-light);">Policy #</span> <span style="font-family:monospace;font-weight:600;">' + UI.esc(p.policyNum) + '</span></div>' : '')
        + (p.limit ? '<div style="font-size:12px;margin-bottom:4px;"><span style="color:var(--text-light);">Limit</span> <strong>' + UI.esc(p.limit) + '</strong></div>' : '')
        + (p.expiry ? '<div style="font-size:12px;margin-bottom:4px;"><span style="color:var(--text-light);">Expires</span> <strong style="color:' + expiryColor + ';">' + InsurancePage._fmtDate(p.expiry) + '</strong></div>' : '')
        + (p.notes ? '<div style="font-size:12px;color:var(--text-light);margin-top:6px;line-height:1.4;">' + UI.esc(p.notes) + '</div>' : '')
        + '<div style="margin-top:10px;display:flex;gap:6px;">'
        + '<button onclick="InsurancePage._showPolicyForm(\'' + p.id + '\')" style="flex:1;background:var(--bg);border:1px solid var(--border);padding:5px 10px;border-radius:6px;font-size:12px;cursor:pointer;">Edit</button>'
        + '<button onclick="InsurancePage._deletePolicy(\'' + p.id + '\')" style="background:none;border:1px solid var(--border);padding:5px 8px;border-radius:6px;font-size:12px;color:var(--text-light);cursor:pointer;">✕</button>'
        + '</div>'
        + '</div>';
    });
    html += '</div>';
    return html;
  },

  // ── Agent tab ─────────────────────────────────────────────────────────
  _renderAgent: function(agent) {
    var html = '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:24px;max-width:480px;">'
      + '<h3 style="margin:0 0 16px;font-size:16px;">Insurance Agent Contact</h3>'
      + '<div style="display:flex;flex-direction:column;gap:12px;">'
      + InsurancePage._field('Agent Name', 'agent-name', agent.name || '', 'e.g. John Smith')
      + InsurancePage._field('Agency', 'agent-agency', agent.agency || '', 'e.g. State Farm / Lockton')
      + InsurancePage._field('Email', 'agent-email', agent.email || '', 'agent@example.com', 'email')
      + InsurancePage._field('Phone', 'agent-phone', agent.phone || '', '(xxx) xxx-xxxx', 'tel')
      + '</div>'
      + '<div style="margin-top:20px;display:flex;gap:10px;">'
      + '<button onclick="InsurancePage._saveAgentForm()" style="background:var(--green-dark);color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">Save</button>'
      + (agent.email ? '<a href="mailto:' + UI.esc(agent.email) + '" style="display:inline-flex;align-items:center;gap:6px;background:var(--bg);border:1px solid var(--border);padding:10px 16px;border-radius:8px;font-size:13px;text-decoration:none;color:var(--text);">✉️ Email Agent</a>' : '')
      + (agent.phone ? '<a href="tel:' + UI.esc(agent.phone.replace(/\D/g,'')) + '" style="display:inline-flex;align-items:center;gap:6px;background:var(--bg);border:1px solid var(--border);padding:10px 16px;border-radius:8px;font-size:13px;text-decoration:none;color:var(--text);">📞 Call Agent</a>' : '')
      + '</div>'
      + '</div>';
    return html;
  },

  _field: function(label, id, value, placeholder, type) {
    return '<div>'
      + '<label style="display:block;font-size:12px;font-weight:600;color:var(--text-light);margin-bottom:4px;text-transform:uppercase;letter-spacing:.4px;">' + label + '</label>'
      + '<input id="' + id + '" type="' + (type || 'text') + '" value="' + UI.esc(value) + '" placeholder="' + UI.esc(placeholder || '') + '" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;outline:none;" onfocus="this.style.borderColor=\'var(--green-dark)\'" onblur="this.style.borderColor=\'var(--border)\'">'
      + '</div>';
  },

  // ── New COI request form ──────────────────────────────────────────────
  _newCert: function(prefillJobId) {
    var agent = InsurancePage._getAgent();
    var policies = InsurancePage._getPolicies();
    var policyList = policies.map(function(p) { return UI.esc(p.type); }).join(', ') || 'General Liability, Workers Compensation, Commercial Auto';

    // Try to get recent jobs for dropdown
    var jobOptions = '<option value="">— No specific job —</option>';
    try {
      var jobs = JSON.parse(localStorage.getItem('bm-jobs') || '[]');
      jobs.filter(function(j) { return j.status !== 'completed' && j.status !== 'cancelled'; })
          .slice(0, 30)
          .forEach(function(j) {
            var sel = j.id === prefillJobId ? ' selected' : '';
            jobOptions += '<option value="' + UI.esc(j.id) + '"' + sel + '>' + UI.esc((j.clientName || '') + (j.property ? ' — ' + j.property : '') + (j.title ? ' (' + j.title + ')' : '')) + '</option>';
          });
    } catch(e) {}

    var body = '<div style="display:flex;flex-direction:column;gap:12px;">'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">LINK TO JOB (optional)</label>'
      + '<select id="coi-job" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;" onchange="InsurancePage._autofillCertJob(this.value)">' + jobOptions + '</select></div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">CERTIFICATE HOLDER NAME *</label>'
      + '<input id="coi-holder-name" placeholder="Client or company name" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;"></div>'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">HOLDER ADDRESS</label>'
      + '<input id="coi-holder-addr" placeholder="Street, City, State" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;"></div>'
      + '</div>'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">WORK DESCRIPTION</label>'
      + '<input id="coi-desc" placeholder="e.g. Tree removal at 19 Donald Lane, Ossining NY" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;"></div>'
      + '<div style="display:flex;gap:16px;align-items:center;">'
      + '<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;"><input type="checkbox" id="coi-addl-insured"> Additional Insured required</label>'
      + '<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;"><input type="checkbox" id="coi-waiver"> Waiver of Subrogation</label>'
      + '</div>'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">DATE NEEDED BY</label>'
      + '<input id="coi-needed-by" type="date" style="padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;"></div>'
      + (agent.email ? '' : '<div style="background:#fff3e0;border-radius:8px;padding:10px 12px;font-size:12px;color:#e65100;">⚠️ No agent email saved — <a onclick="InsurancePage._tab=\'agent\';UI.closeModal();loadPage(\'insurance\')" style="color:var(--accent);cursor:pointer;">add agent info first</a> to email the request automatically.</div>')
      + '</div>';

    var btnLabel = agent.email ? '📧 Send to Agent + Track' : '📄 Track Only';
    UI.modal('Request Certificate of Insurance', body, [
      { label: btnLabel, fn: 'InsurancePage._submitCertRequest()' },
      { label: 'Cancel', fn: 'UI.closeModal()' }
    ]);
  },

  _autofillCertJob: function(jobId) {
    if (!jobId) return;
    try {
      var jobs = JSON.parse(localStorage.getItem('bm-jobs') || '[]');
      var job = jobs.find(function(j) { return j.id === jobId; });
      if (!job) return;
      var nameEl = document.getElementById('coi-holder-name');
      var addrEl = document.getElementById('coi-holder-addr');
      var descEl = document.getElementById('coi-desc');
      if (nameEl && !nameEl.value) nameEl.value = job.clientName || '';
      if (addrEl && !addrEl.value) addrEl.value = job.property || '';
      if (descEl && !descEl.value) descEl.value = job.title || job.description || '';
    } catch(e) {}
  },

  _submitCertRequest: function() {
    var holderName = (document.getElementById('coi-holder-name') || {}).value || '';
    var holderAddr = (document.getElementById('coi-holder-addr') || {}).value || '';
    var description = (document.getElementById('coi-desc') || {}).value || '';
    var jobId = (document.getElementById('coi-job') || {}).value || '';
    var addlInsured = (document.getElementById('coi-addl-insured') || {}).checked || false;
    var waiver = (document.getElementById('coi-waiver') || {}).checked || false;
    var neededBy = (document.getElementById('coi-needed-by') || {}).value || '';

    if (!holderName.trim()) { UI.toast('Certificate holder name is required', 'error'); return; }

    var agent = InsurancePage._getAgent();
    var policies = InsurancePage._getPolicies();
    var policyList = policies.length ? policies.map(function(p) { return p.type; }).join(', ') : 'General Liability, Workers Compensation, Commercial Auto';

    // Build cert record
    var cert = {
      id: InsurancePage._id(),
      jobId: jobId,
      jobTitle: InsurancePage._jobTitle(jobId),
      clientName: holderName,
      holderName: holderName,
      holderAddr: holderAddr,
      description: description,
      additionalInsured: addlInsured,
      waiverSubrogation: waiver,
      neededBy: neededBy,
      requested: new Date().toISOString(),
      status: 'requested',
      notes: ''
    };

    var certs = InsurancePage._getCerts();
    certs.unshift(cert);
    InsurancePage._saveCerts(certs);
    UI.closeModal();

    // Send email to agent if configured
    if (agent.email) {
      var subject = 'COI Request — ' + holderName + (description ? ' / ' + description : '');
      var bodyLines = [
        'Hi ' + (agent.name || 'there') + ',',
        '',
        'Please send a Certificate of Insurance for the following:',
        '',
        'Certificate Holder: ' + holderName,
        holderAddr ? 'Address: ' + holderAddr : '',
        description ? 'Project / Work Description: ' + description : '',
        neededBy ? 'Needed By: ' + neededBy : '',
        '',
        'Policies to include: ' + policyList,
        addlInsured ? '→ Please list the certificate holder as ADDITIONAL INSURED.' : '',
        waiver ? '→ Please include a Waiver of Subrogation in favor of the holder.' : '',
        '',
        'Thank you,',
        'Second Nature Tree Service',
        '(914) 391-5233'
      ].filter(function(l) { return l !== ''; }).join('\n');

      window.location.href = 'mailto:' + encodeURIComponent(agent.email)
        + '?subject=' + encodeURIComponent(subject)
        + '&body=' + encodeURIComponent(bodyLines);
    }

    InsurancePage._tab = 'certs';
    loadPage('insurance');
    UI.toast('COI request created' + (agent.email ? ' — email opened to agent' : ''));
  },

  _jobTitle: function(jobId) {
    if (!jobId) return '';
    try {
      var jobs = JSON.parse(localStorage.getItem('bm-jobs') || '[]');
      var job = jobs.find(function(j) { return j.id === jobId; });
      return job ? (job.clientName || '') + (job.title ? ' — ' + job.title : '') : '';
    } catch(e) { return ''; }
  },

  _markStatus: function(certId, status) {
    var certs = InsurancePage._getCerts();
    var cert = certs.find(function(c) { return c.id === certId; });
    if (!cert) return;
    cert.status = status;
    if (status === 'received') cert.received = new Date().toISOString();
    if (status === 'sent') cert.sentToClient = new Date().toISOString();
    InsurancePage._saveCerts(certs);
    loadPage('insurance');
    UI.toast(status === 'received' ? 'Marked as received' : 'Marked as sent to client');
  },

  _resendRequest: function(certId) {
    var certs = InsurancePage._getCerts();
    var cert = certs.find(function(c) { return c.id === certId; });
    if (!cert) return;
    var agent = InsurancePage._getAgent();
    if (!agent.email) { UI.toast('No agent email saved', 'error'); return; }
    var policies = InsurancePage._getPolicies();
    var policyList = policies.length ? policies.map(function(p) { return p.type; }).join(', ') : 'General Liability, Workers Compensation, Commercial Auto';
    var subject = 'COI Request (Follow-up) — ' + (cert.holderName || cert.clientName);
    var body = 'Hi ' + (agent.name || 'there') + ',\n\nFollowing up on my COI request for:\n\nCertificate Holder: ' + (cert.holderName || '') + '\n' + (cert.holderAddr ? 'Address: ' + cert.holderAddr + '\n' : '') + (cert.description ? 'Project: ' + cert.description + '\n' : '') + '\nPolicies: ' + policyList + '\n' + (cert.additionalInsured ? '\n→ Additional Insured required\n' : '') + (cert.waiverSubrogation ? '\n→ Waiver of Subrogation required\n' : '') + '\nThank you,\nSecond Nature Tree Service';
    window.location.href = 'mailto:' + encodeURIComponent(agent.email) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  },

  _deleteCert: function(certId) {
    if (!confirm('Delete this certificate request?')) return;
    InsurancePage._saveCerts(InsurancePage._getCerts().filter(function(c) { return c.id !== certId; }));
    loadPage('insurance');
  },

  // ── Policy form (add/edit) ────────────────────────────────────────────
  _showPolicyForm: function(policyId) {
    var policies = InsurancePage._getPolicies();
    var p = policyId ? (policies.find(function(x) { return x.id === policyId; }) || {}) : {};
    var types = ['General Liability', 'Workers Compensation', 'Commercial Auto', 'Umbrella / Excess', 'Inland Marine / Equipment', 'Other'];
    var typeOpts = types.map(function(t) { return '<option' + (p.type === t ? ' selected' : '') + '>' + t + '</option>'; }).join('');

    var body = '<div style="display:flex;flex-direction:column;gap:12px;">'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">POLICY TYPE</label>'
      + '<select id="pol-type" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;">' + typeOpts + '</select></div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">CARRIER</label>'
      + '<input id="pol-carrier" value="' + UI.esc(p.carrier || '') + '" placeholder="e.g. Travelers, Hartford" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;"></div>'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">POLICY NUMBER</label>'
      + '<input id="pol-num" value="' + UI.esc(p.policyNum || '') + '" placeholder="Policy #" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;font-family:monospace;"></div>'
      + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">COVERAGE LIMIT</label>'
      + '<input id="pol-limit" value="' + UI.esc(p.limit || '') + '" placeholder="e.g. $1,000,000 per occ." style="width:100%;box-sizing:border-box;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;"></div>'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">EXPIRATION DATE</label>'
      + '<input id="pol-expiry" type="date" value="' + UI.esc(p.expiry || '') + '" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;"></div>'
      + '</div>'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">NOTES</label>'
      + '<input id="pol-notes" value="' + UI.esc(p.notes || '') + '" placeholder="Any notes (deductible, special endorsements, etc.)" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;"></div>'
      + '</div>';

    UI.modal(policyId ? 'Edit Policy' : 'Add Policy', body, [
      { label: 'Save Policy', fn: 'InsurancePage._savePolicyForm("' + (policyId || '') + '")' },
      { label: 'Cancel', fn: 'UI.closeModal()' }
    ]);
  },

  _savePolicyForm: function(policyId) {
    var policies = InsurancePage._getPolicies();
    var row = {
      id: policyId || InsurancePage._id(),
      type: (document.getElementById('pol-type') || {}).value || 'General Liability',
      carrier: (document.getElementById('pol-carrier') || {}).value || '',
      policyNum: (document.getElementById('pol-num') || {}).value || '',
      limit: (document.getElementById('pol-limit') || {}).value || '',
      expiry: (document.getElementById('pol-expiry') || {}).value || '',
      notes: (document.getElementById('pol-notes') || {}).value || ''
    };
    if (policyId) {
      var idx = policies.findIndex(function(p) { return p.id === policyId; });
      if (idx >= 0) policies[idx] = row; else policies.push(row);
    } else {
      policies.push(row);
    }
    InsurancePage._savePolicies(policies);
    UI.closeModal();
    loadPage('insurance');
    UI.toast('Policy saved');
  },

  _deletePolicy: function(policyId) {
    if (!confirm('Delete this policy?')) return;
    InsurancePage._savePolicies(InsurancePage._getPolicies().filter(function(p) { return p.id !== policyId; }));
    loadPage('insurance');
  },

  _saveAgentForm: function() {
    InsurancePage._saveAgent({
      name: (document.getElementById('agent-name') || {}).value || '',
      agency: (document.getElementById('agent-agency') || {}).value || '',
      email: (document.getElementById('agent-email') || {}).value || '',
      phone: (document.getElementById('agent-phone') || {}).value || ''
    });
    loadPage('insurance');
    UI.toast('Agent info saved');
  },

  // ── Helpers ───────────────────────────────────────────────────────────
  _fmtDate: function(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch(e) { return iso; }
  }
};
