/**
 * Branch Manager — Equipment Inventory & Maintenance Tracker
 * Track all equipment, maintenance schedules, hours, repair history
 */
var EquipmentPage = {
  render: function() {
    var equipment = EquipmentPage.getAll();
    var needsMaint = equipment.filter(function(e) { return EquipmentPage._needsMaintenance(e); });

    // Total maintenance cost from all history
    var totalMaintCost = 0;
    equipment.forEach(function(e) {
      var histKey = 'bm-equipment-history-' + e.id;
      try {
        var hist = JSON.parse(localStorage.getItem(histKey)) || [];
        hist.forEach(function(h) { totalMaintCost += (h.cost || 0); });
      } catch(err) {}
    });

    var html = '<div class="stat-grid">'
      + UI.statCard('Equipment', equipment.length.toString(), 'Total items tracked', '', '')
      + UI.statCard('Needs Service', needsMaint.length.toString(), needsMaint.length > 0 ? '⚠️ Overdue' : 'All good ✅', needsMaint.length > 0 ? 'down' : 'up', '')
      + UI.statCard('Total Value', UI.moneyInt(equipment.reduce(function(s, e) { return s + (e.value || 0); }, 0)), 'Replacement cost', '', '')
      + UI.statCard('Maintenance Cost', UI.moneyInt(totalMaintCost), 'All logged service costs', '', '')
      + '</div>';

    // Maintenance alerts
    if (needsMaint.length) {
      html += '<div style="background:#fff3e0;border-radius:12px;padding:16px;border-left:4px solid #e65100;margin-bottom:16px;">'
        + '<h4 style="color:#e65100;margin-bottom:8px;">⚠️ Maintenance Due</h4>';
      needsMaint.forEach(function(e) {
        html += '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;">'
          + '<span><strong>' + e.name + '</strong> — ' + (e.nextService || 'Service needed') + '</span>'
          + '<button onclick="EquipmentPage.logService(\'' + e.id + '\')" style="background:#e65100;color:#fff;border:none;padding:4px 10px;border-radius:4px;font-size:11px;cursor:pointer;">Mark Done</button>'
          + '</div>';
      });
      html += '</div>';
    }

    // Equipment checkout log
    var checkouts = [];
    try { checkouts = JSON.parse(localStorage.getItem('bm-equipment-checkouts') || '[]'); } catch(e) {}
    var activeCheckouts = checkouts.filter(function(c) { return !c.returnedAt; });

    html += '<div style="background:var(--white);border-radius:12px;padding:20px;border:1px solid var(--border);margin-bottom:16px;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">'
      + '<h3 style="font-size:16px;">Checked Out</h3>'
      + '<button onclick="EquipmentPage.showCheckout()" style="background:var(--green-dark);color:#fff;border:none;padding:6px 14px;border-radius:6px;font-weight:600;cursor:pointer;font-size:12px;">+ Check Out</button></div>';

    if (activeCheckouts.length === 0) {
      html += '<div style="text-align:center;padding:16px;color:var(--text-light);font-size:13px;">No equipment currently checked out.</div>';
    } else {
      activeCheckouts.forEach(function(c) {
        var dur = Math.round((Date.now() - new Date(c.checkedOutAt).getTime()) / 3600000);
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f5f5f5;">'
          + '<div><div style="font-size:14px;font-weight:600;">' + UI.esc(c.equipmentName) + '</div>'
          + '<div style="font-size:12px;color:var(--text-light);">' + UI.esc(c.crewMember) + ' · ' + dur + 'h ago' + (c.jobName ? ' · ' + UI.esc(c.jobName) : '') + '</div></div>'
          + '<button onclick="EquipmentPage.returnEquipment(\'' + c.id + '\')" style="background:#e8f5e9;color:#2e7d32;border:1px solid #a5d6a7;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">Return</button>'
          + '</div>';
      });
    }
    html += '</div>';

    // Equipment list
    html += '<div style="background:var(--white);border-radius:12px;padding:20px;border:1px solid var(--border);">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">'
      + '<h3 style="font-size:16px;">Equipment</h3>'
      + '<button onclick="EquipmentPage.showForm()" style="background:var(--green-dark);color:#fff;border:none;padding:8px 16px;border-radius:8px;font-weight:600;cursor:pointer;font-size:13px;">+ Add Equipment</button></div>';

    var categories = {};
    equipment.forEach(function(e) {
      var cat = e.category || 'Other';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(e);
    });

    Object.keys(categories).sort().forEach(function(cat) {
      html += '<div style="margin-bottom:16px;">'
        + '<h4 style="font-size:13px;color:var(--text-light);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;border-bottom:1px solid var(--border);padding-bottom:4px;">' + cat + '</h4>';
      categories[cat].forEach(function(e) {
        var statusColor = e.status === 'active' ? '#4caf50' : e.status === 'repair' ? '#f44336' : '#999';
        var lastInsp = EquipmentPage._lastInspection(e.id);
        var inspLabel = lastInsp
          ? 'Last checked: ' + UI.dateShort(lastInsp.date) + (lastInsp.checkedBy ? ' · ' + UI.esc(lastInsp.checkedBy) : '')
          : '⚠️ Not inspected yet';
        var inspColor = lastInsp ? 'var(--text-light)' : '#c0392b';
        html += '<div style="padding:8px 0;border-bottom:1px solid #f5f5f5;">'
          + '<div style="display:flex;justify-content:space-between;align-items:center;">'
          + '<div style="display:flex;align-items:center;gap:8px;flex:1;cursor:pointer;" onclick="EquipmentPage.showDetail(\'' + e.id + '\')">'
          + '<span style="width:8px;height:8px;border-radius:50%;background:' + statusColor + ';flex-shrink:0;"></span>'
          + '<div><strong style="font-size:14px;">' + e.name + '</strong>'
          + '<div style="font-size:12px;color:var(--text-light);">' + (e.make || '') + ' ' + (e.model || '') + (e.year ? ' · ' + e.year : '') + (e.serial ? ' · SN: ' + e.serial : '') + '</div>'
          + '<div style="font-size:11px;color:' + inspColor + ';margin-top:2px;">' + inspLabel + '</div>'
          + '</div></div>'
          + '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">'
          + '<div style="text-align:right;font-size:12px;min-width:60px;">'
          + '<div style="font-weight:600;">' + (e.hours ? e.hours + ' hrs' : '') + '</div>'
          + '<div style="color:var(--text-light);">' + (e.value ? UI.money(e.value) : '') + '</div></div>'
          + '<button onclick="event.stopPropagation();EquipmentPage.toggleChecklist(\'' + e.id + '\')" style="background:#fffbe6;color:#8a6d00;border:1px solid #f0d874;padding:4px 8px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;">📋 Checklist</button>'
          + '<button onclick="event.stopPropagation();EquipmentPage.logHours(\'' + e.id + '\')" style="background:#e8f5e9;color:#2e7d32;border:1px solid #a5d6a7;padding:4px 8px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;">+ Hrs</button>'
          + '</div></div>'
          // Collapsible checklist panel (hidden by default)
          + '<div id="eq-checklist-' + e.id + '" style="display:none;margin-top:10px;padding:12px;background:#fafafa;border:1px solid var(--border);border-radius:8px;">'
          +   EquipmentPage._renderChecklistPanel(e)
          + '</div>'
          + '</div>';
      });
      html += '</div>';
    });

    if (equipment.length === 0) {
      html += '<div style="text-align:center;padding:24px;color:var(--text-light);">'
        + '<p>No equipment tracked yet. Add your trucks, saws, and gear.</p></div>';
    }
    html += '</div>';

    return html;
  },

  getAll: function() {
    var stored = localStorage.getItem('bm-equipment');
    if (stored) return JSON.parse(stored);
    // Seed with common tree service equipment
    var defaults = [
      { id: 'eq1', name: 'Bucket Truck', category: 'Trucks', make: '', model: '', status: 'active', value: 85000, hours: 0, nextService: 'Oil change @ 5000 mi' },
      { id: 'eq2', name: 'Chip Truck', category: 'Trucks', make: '', model: '', status: 'active', value: 45000, hours: 0 },
      { id: 'eq3', name: 'Ram 2500', category: 'Trucks', make: 'Ram', model: '2500', status: 'active', value: 45000, hours: 0 },
      { id: 'eq4', name: 'Chipper', category: 'Equipment', make: '', model: '', status: 'active', value: 35000, hours: 0, nextService: 'Blade sharpen @ 50 hrs' },
      { id: 'eq5', name: 'Stump Grinder', category: 'Equipment', make: '', model: '', status: 'active', value: 15000, hours: 0 },
      { id: 'eq6', name: 'Loader', category: 'Equipment', make: '', model: '', status: 'active', value: 25000, hours: 0 },
      { id: 'eq7', name: 'Climbing Gear Set', category: 'Safety', make: '', model: '', status: 'active', value: 3000, nextService: 'Annual inspection' },
      { id: 'eq8', name: 'Stihl MS 462', category: 'Saws', make: 'Stihl', model: 'MS 462', status: 'active', value: 1100, hours: 0 },
      { id: 'eq9', name: 'Stihl MS 261', category: 'Saws', make: 'Stihl', model: 'MS 261', status: 'active', value: 700, hours: 0 },
      { id: 'eq10', name: 'Trailer', category: 'Trucks', make: '', model: '', status: 'active', value: 5000 }
    ];
    localStorage.setItem('bm-equipment', JSON.stringify(defaults));
    return defaults;
  },

  _needsMaintenance: function(e) {
    if (!e.lastService) return !!e.nextService;
    var daysSince = (Date.now() - new Date(e.lastService).getTime()) / 86400000;
    return daysSince > (e.serviceIntervalDays || 90);
  },

  showForm: function(id) {
    var e = id ? EquipmentPage.getAll().find(function(eq) { return eq.id === id; }) : null;
    var categories = ['Trucks', 'Equipment', 'Saws', 'Safety', 'Rigging', 'Other'];

    var html = '<form id="eq-form" onsubmit="EquipmentPage.save(event, ' + (id ? '\'' + id + '\'' : 'null') + ')">'
      + UI.formField('Name', 'text', 'eq-name', e ? e.name : '', { placeholder: 'e.g., Stihl MS 462' })
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">'
      + UI.formField('Category', 'select', 'eq-cat', e ? e.category : '', { options: categories })
      + UI.formField('Status', 'select', 'eq-status', e ? e.status : 'active', { options: ['active', 'repair', 'retired'] })
      + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">'
      + UI.formField('Make', 'text', 'eq-make', e ? e.make : '', { placeholder: 'Stihl' })
      + UI.formField('Model', 'text', 'eq-model', e ? e.model : '', { placeholder: 'MS 462' })
      + UI.formField('Year', 'text', 'eq-year', e ? e.year : '', { placeholder: '2024' })
      + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">'
      + UI.formField('Value ($)', 'number', 'eq-value', e ? e.value : '', { placeholder: '5000' })
      + UI.formField('Serial Number', 'text', 'eq-serial', e ? e.serial : '', { placeholder: 'SN12345' })
      + '</div>'
      + UI.formField('Service Notes', 'text', 'eq-service', e ? e.nextService : '', { placeholder: 'e.g., Oil change every 100 hours' })
      + '</form>';

    UI.showModal(id ? 'Edit Equipment' : 'Add Equipment', html, {
      footer: '<button class="btn btn-outline" onclick="UI.closeModal()">Cancel</button>'
        + ' <button class="btn btn-primary" onclick="document.getElementById(\'eq-form\').requestSubmit()">Save</button>'
    });
  },

  save: function(e, id) {
    e.preventDefault();
    var all = EquipmentPage.getAll();
    var data = {
      name: document.getElementById('eq-name').value,
      category: document.getElementById('eq-cat').value,
      status: document.getElementById('eq-status').value,
      make: document.getElementById('eq-make').value,
      model: document.getElementById('eq-model').value,
      year: document.getElementById('eq-year').value,
      value: parseFloat(document.getElementById('eq-value').value) || 0,
      serial: document.getElementById('eq-serial').value,
      nextService: document.getElementById('eq-service').value
    };

    if (id) {
      var idx = all.findIndex(function(eq) { return eq.id === id; });
      if (idx >= 0) Object.assign(all[idx], data);
    } else {
      data.id = Date.now().toString(36);
      data.hours = 0;
      data.createdAt = new Date().toISOString();
      all.push(data);
    }
    localStorage.setItem('bm-equipment', JSON.stringify(all));
    UI.closeModal();
    UI.toast(id ? 'Equipment updated' : 'Equipment added');
    loadPage('equipment');
  },

  showDetail: function(id) {
    var e = EquipmentPage.getAll().find(function(eq) { return eq.id === id; });
    if (!e) return;

    // Load service history
    var histKey = 'bm-equipment-history-' + id;
    var history = [];
    try { history = JSON.parse(localStorage.getItem(histKey)) || []; } catch(err) {}

    var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">'
      + '<div><h4 style="margin-bottom:8px;">Details</h4>'
      + '<div style="font-size:14px;line-height:2;">'
      + '<div>Make: <strong>' + (e.make || '—') + '</strong></div>'
      + '<div>Model: <strong>' + (e.model || '—') + '</strong></div>'
      + '<div>Year: <strong>' + (e.year || '—') + '</strong></div>'
      + '<div>Serial: <strong>' + (e.serial || '—') + '</strong></div>'
      + '<div>Value: <strong>' + UI.money(e.value || 0) + '</strong></div>'
      + '<div>Hours: <strong>' + (e.hours || 0) + '</strong></div></div></div>'
      + '<div><h4 style="margin-bottom:8px;">Service</h4>'
      + '<div style="font-size:14px;line-height:2;">'
      + '<div>Status: ' + UI.statusBadge(e.status) + '</div>'
      + '<div>Next Service: <strong>' + (e.nextService || 'None set') + '</strong></div>'
      + '<div>Last Service: <strong>' + (e.lastService ? UI.dateShort(e.lastService) : 'Never') + '</strong></div></div></div></div>';

    // Service history section
    html += '<div style="margin-top:20px;">'
      + '<h4 style="font-size:14px;font-weight:700;margin-bottom:10px;border-bottom:1px solid var(--border);padding-bottom:6px;">Service History</h4>';
    if (history.length === 0) {
      html += '<div style="font-size:13px;color:var(--text-light);padding:8px 0;">No service logged yet.</div>';
    } else {
      var recent = history.slice(0, 5);
      recent.forEach(function(h) {
        html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:8px 0;border-bottom:1px solid #f5f5f5;font-size:13px;">'
          + '<div>'
          + '<div style="font-weight:600;">' + UI.esc(h.type) + '</div>'
          + (h.notes ? '<div style="color:var(--text-light);margin-top:2px;">' + UI.esc(h.notes) + '</div>' : '')
          + '</div>'
          + '<div style="text-align:right;flex-shrink:0;margin-left:12px;">'
          + '<div style="font-weight:600;color:var(--green-dark);">' + (h.cost > 0 ? UI.money(h.cost) : '') + '</div>'
          + '<div style="color:var(--text-light);">' + UI.dateShort(h.date) + '</div>'
          + '</div></div>';
      });
      if (history.length > 5) {
        html += '<div style="font-size:12px;color:var(--text-light);padding:6px 0;">+ ' + (history.length - 5) + ' more entries</div>';
      }
    }
    html += '</div>';

    if (typeof Photos !== 'undefined') {
      html += Photos.renderGallery('equipment', id);
    }

    UI.showModal(e.name, html, {
      wide: true,
      footer: '<button class="btn btn-outline" onclick="UI.closeModal()">Close</button>'
        + ' <button class="btn btn-outline" onclick="EquipmentPage.logHours(\'' + id + '\')">⏱ Log Hours</button>'
        + ' <button class="btn btn-outline" onclick="EquipmentPage.logService(\'' + id + '\')">✅ Log Service</button>'
        + ' <button class="btn btn-primary" onclick="UI.closeModal();EquipmentPage.showForm(\'' + id + '\')">Edit</button>'
    });
  },

  logService: function(id) {
    var all = EquipmentPage.getAll();
    var eq = all.find(function(e) { return e.id === id; });
    if (!eq) return;

    var html = '<div style="display:grid;gap:10px;">'
      + '<div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Service Type</label>'
      + '<select id="svc-type" style="width:100%;padding:10px;border:2px solid var(--border);border-radius:8px;font-size:14px;">'
      + '<option>Oil Change</option><option>Blade Sharpen</option><option>Filter Replace</option>'
      + '<option>Annual Inspection</option><option>Repair</option><option>Other</option>'
      + '</select></div>'
      + '<div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Notes</label>'
      + '<input type="text" id="svc-notes" placeholder="What was done?" style="width:100%;padding:10px;border:2px solid var(--border);border-radius:8px;font-size:14px;"></div>'
      + '<div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Cost ($)</label>'
      + '<input type="number" id="svc-cost" placeholder="0" step="0.01" style="width:100%;padding:10px;border:2px solid var(--border);border-radius:8px;font-size:14px;"></div>'
      + '<div style="display:flex;gap:8px;justify-content:flex-end;">'
      + '<button class="btn btn-outline" onclick="UI.closeModal()">Cancel</button>'
      + '<button class="btn btn-primary" onclick="EquipmentPage._saveService(\'' + id + '\')">Log Service</button>'
      + '</div></div>';
    UI.showModal('Log Service — ' + eq.name, html);
  },

  _saveService: function(id) {
    var type = document.getElementById('svc-type').value;
    var notes = document.getElementById('svc-notes').value;
    var cost = parseFloat(document.getElementById('svc-cost').value) || 0;

    // Save to history
    var histKey = 'bm-equipment-history-' + id;
    var history = [];
    try { history = JSON.parse(localStorage.getItem(histKey)) || []; } catch(e) {}
    history.unshift({ type: type, notes: notes, cost: cost, date: new Date().toISOString() });
    localStorage.setItem(histKey, JSON.stringify(history));

    // Update equipment lastService
    var all = EquipmentPage.getAll();
    var eq = all.find(function(e) { return e.id === id; });
    if (eq) {
      eq.lastService = new Date().toISOString();
      localStorage.setItem('bm-equipment', JSON.stringify(all));
    }

    UI.closeModal();
    UI.toast('Service logged for ' + (eq ? eq.name : 'equipment'));
    loadPage('equipment');
  },

  logHours: function(id) {
    var eq = EquipmentPage.getAll().find(function(e) { return e.id === id; });
    if (!eq) return;
    var html = '<div style="display:grid;gap:10px;">'
      + '<div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Hours Used Today</label>'
      + '<input type="number" id="hours-used" value="8" step="0.5" min="0.5" style="width:100%;padding:10px;border:2px solid var(--border);border-radius:8px;font-size:18px;font-weight:700;text-align:center;"></div>'
      + '<div style="font-size:13px;color:var(--text-light);text-align:center;">Current total: <strong>' + (eq.hours || 0) + ' hrs</strong></div>'
      + '<div style="display:flex;gap:8px;justify-content:flex-end;">'
      + '<button class="btn btn-outline" onclick="UI.closeModal()">Cancel</button>'
      + '<button class="btn btn-primary" onclick="EquipmentPage._saveHours(\'' + id + '\')">Add Hours</button>'
      + '</div></div>';
    UI.showModal('Log Hours — ' + eq.name, html);
  },

  _saveHours: function(id) {
    var add = parseFloat(document.getElementById('hours-used').value) || 0;
    var all = EquipmentPage.getAll();
    var eq = all.find(function(e) { return e.id === id; });
    if (eq && add > 0) {
      eq.hours = (eq.hours || 0) + add;
      localStorage.setItem('bm-equipment', JSON.stringify(all));
      UI.closeModal();
      UI.toast(add + ' hrs logged for ' + eq.name + ' (' + eq.hours + ' total)');
      loadPage('equipment');
    }
  },

  // Checkout / Return
  showCheckout: function() {
    var equipment = EquipmentPage.getAll().filter(function(e) { return e.status === 'active'; });
    var team = JSON.parse(localStorage.getItem('bm-team') || '[]');
    if (team.length === 0) team = [{ name: 'Doug Brown' }];
    var todayJobs = DB.jobs.getAll().filter(function(j) {
      var today = new Date().toISOString().split('T')[0];
      return j.scheduledDate && j.scheduledDate.substring(0, 10) === today;
    });

    var html = '<form id="checkout-form">'
      + '<div class="form-group"><label>Equipment *</label><select id="co-equip" required style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;">';
    equipment.forEach(function(e) { html += '<option value="' + e.id + '">' + e.name + ' (' + (e.category || '') + ')</option>'; });
    html += '</select></div>'
      + '<div class="form-group"><label>Crew Member *</label><select id="co-crew" required style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;">';
    team.forEach(function(t) { html += '<option>' + (t.name || '') + '</option>'; });
    html += '</select></div>'
      + '<div class="form-group"><label>Job (optional)</label><select id="co-job" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;"><option value="">— None —</option>';
    todayJobs.forEach(function(j) { html += '<option value="' + j.id + '">' + (j.clientName || '') + ' (#' + (j.jobNumber || '') + ')</option>'; });
    html += '</select></div>'
      + '<div class="form-group"><label>Notes</label><input type="text" id="co-notes" placeholder="e.g., Took 2 saws, extra chain" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;"></div>'
      + '</form>';

    UI.showModal('Check Out Equipment', html, {
      footer: '<button class="btn btn-outline" onclick="UI.closeModal()">Cancel</button>'
        + ' <button class="btn btn-primary" onclick="EquipmentPage.saveCheckout()">Check Out</button>'
    });
  },

  saveCheckout: function() {
    var equipId = document.getElementById('co-equip').value;
    var crew = document.getElementById('co-crew').value;
    if (!equipId || !crew) { alert('Select equipment and crew member'); return; }

    var equip = EquipmentPage.getAll().find(function(e) { return e.id === equipId; });
    var jobEl = document.getElementById('co-job');
    var jobId = jobEl ? jobEl.value : '';
    var jobName = jobId ? jobEl.options[jobEl.selectedIndex].text : '';
    var notes = (document.getElementById('co-notes') || {}).value || '';

    var checkouts = [];
    try { checkouts = JSON.parse(localStorage.getItem('bm-equipment-checkouts') || '[]'); } catch(e) {}
    checkouts.unshift({
      id: Date.now().toString(36),
      equipmentId: equipId,
      equipmentName: equip ? equip.name : equipId,
      crewMember: crew,
      jobId: jobId,
      jobName: jobName,
      notes: notes,
      checkedOutAt: new Date().toISOString(),
      returnedAt: null
    });
    localStorage.setItem('bm-equipment-checkouts', JSON.stringify(checkouts));
    UI.closeModal();
    UI.toast(equip.name + ' checked out to ' + crew);
    loadPage('equipment');
  },

  returnEquipment: function(checkoutId) {
    var checkouts = [];
    try { checkouts = JSON.parse(localStorage.getItem('bm-equipment-checkouts') || '[]'); } catch(e) {}
    var co = checkouts.find(function(c) { return c.id === checkoutId; });
    if (co) {
      co.returnedAt = new Date().toISOString();
      localStorage.setItem('bm-equipment-checkouts', JSON.stringify(checkouts));
      UI.toast(co.equipmentName + ' returned by ' + co.crewMember);
      loadPage('equipment');
    }
  },

  // ═══ Pre-use Safety Checklists ═══
  // Default checklists keyed by a normalized "kind" string derived from name/category/model.
  _checklistDefaults: {
    'bucket-truck': ['Boom extends/retracts smoothly','Outriggers deploy + lock','Hydraulic fluid level OK','Emergency descent works','Upper controls responsive','Lower controls responsive','Safety harness anchor points','Insulator bucket clean + dry','Horn + backup alarm','Tires (pressure, tread)','Lights (head/brake/turn)','Insurance + registration in cab'],
    'chipper': ['Blades sharp + bolts tight','Safety bar engages + kills blade','Feed wheel rotates freely','Discharge chute clear + rotates','Fuel level + oil','PTO shield in place','Kill switch accessible','Hose + clamps intact','Hitch secure'],
    'crane': ['Outriggers level + locked','Boom extends full range','Load line + hook inspected for wear','Anti-two-block working','Hydraulic system (no leaks)','Radio remote paired + charged','Load chart posted','Operator cert valid + in cab','Fire extinguisher + first aid'],
    'stump-grinder': ['Teeth sharp + bolts tight','Guard in place','Kill switch accessible','Fuel + oil','Tires/tracks OK','Trailer lights + safety chains (if towed)','PPE: face shield + chaps on rig'],
    'mini-skid': ['Tracks or tires OK','Hydraulic fluid level','Seatbelt functional','Horn + backup alarm','Bucket/attachment secure','Quick-attach pins engaged','Lights + mirrors','Fuel level'],
    'dump-truck': ['Body raises + locks','Tailgate latches + releases','Brakes firm','Tires (pressure + tread)','Lights + turn signals','Load cover/tarp','Registration + insurance','Pre-trip DOT walkaround complete'],
    'chainsaw': ['Chain sharp + tension correct','Bar oil full','Fuel mix correct','Chain brake engages','Throttle trigger interlock works','Muffler + heat shield intact','PPE: chaps + helmet + ears + eyes'],
    'trailer': ['Hitch secure + pin + clip','Safety chains crossed','Breakaway cable attached','Lights (running, brake, turn)','Tires (pressure + tread)','Load secured + strapped','License plate + registration'],
    'generic': ['Fluid levels OK','Tires / tracks OK','Controls functional','Safety features (brakes, kill switches) tested','Fuel level','Visual inspection — no damage/leaks','Documentation in vehicle']
  },

  _detectKind: function(e) {
    var hay = ((e.name || '') + ' ' + (e.make || '') + ' ' + (e.model || '') + ' ' + (e.category || '')).toLowerCase();
    if (/bucket/.test(hay)) return 'bucket-truck';
    if (/dump/.test(hay)) return 'dump-truck';
    if (/chipper/.test(hay)) return 'chipper';
    if (/crane/.test(hay)) return 'crane';
    if (/stump/.test(hay)) return 'stump-grinder';
    if (/(mini[- ]?skid|loader|skid.?steer)/.test(hay)) return 'mini-skid';
    if (/(chainsaw|stihl|husq|saw)/.test(hay)) return 'chainsaw';
    if (/trailer/.test(hay)) return 'trailer';
    return 'generic';
  },

  _checklistItemsFor: function(e) {
    var kind = EquipmentPage._detectKind(e);
    return EquipmentPage._checklistDefaults[kind] || EquipmentPage._checklistDefaults.generic;
  },

  _allInspections: function() {
    try { return JSON.parse(localStorage.getItem('bm-equipment-inspections') || '[]'); } catch(e) { return []; }
  },

  _lastInspection: function(equipmentId) {
    var all = EquipmentPage._allInspections().filter(function(r) { return r.equipmentId === equipmentId; });
    if (!all.length) return null;
    all.sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });
    return all[0];
  },

  _renderChecklistPanel: function(e) {
    var items = EquipmentPage._checklistItemsFor(e);
    var kind = EquipmentPage._detectKind(e);
    var cbHtml = '';
    items.forEach(function(item, i) {
      var cid = 'chk-' + e.id + '-' + i;
      cbHtml += '<label for="' + cid + '" style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;font-size:13px;cursor:pointer;">'
        + '<input type="checkbox" id="' + cid + '" data-item="' + UI.esc(item) + '" style="margin-top:3px;flex-shrink:0;">'
        + '<span>' + UI.esc(item) + '</span>'
        + '</label>';
    });
    return '<div style="font-size:12px;color:var(--text-light);margin-bottom:8px;">Pre-use safety check <span style="background:#eef;color:#334;padding:1px 6px;border-radius:10px;font-weight:600;margin-left:4px;">' + kind + '</span></div>'
      + '<div id="eq-checklist-items-' + e.id + '">' + cbHtml + '</div>'
      + '<div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">'
      +   '<input type="text" id="eq-chk-who-' + e.id + '" placeholder="Checked by (name)" style="flex:1;min-width:140px;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:13px;">'
      +   '<button onclick="EquipmentPage.markInspected(\'' + e.id + '\')" style="background:var(--green-dark);color:#fff;border:none;padding:8px 14px;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer;">Mark Inspected</button>'
      + '</div>';
  },

  toggleChecklist: function(id) {
    var el = document.getElementById('eq-checklist-' + id);
    if (!el) return;
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
  },

  markInspected: function(id) {
    var eq = EquipmentPage.getAll().find(function(e) { return e.id === id; });
    if (!eq) return;
    var wrap = document.getElementById('eq-checklist-items-' + id);
    if (!wrap) return;
    var boxes = wrap.querySelectorAll('input[type="checkbox"]');
    var items = EquipmentPage._checklistItemsFor(eq);
    var checked = [];
    var unchecked = [];
    boxes.forEach(function(b) {
      if (b.checked) checked.push(b.getAttribute('data-item'));
      else unchecked.push(b.getAttribute('data-item'));
    });
    if (checked.length !== items.length) {
      if (!confirm('Some items are unchecked (' + unchecked.length + '). Record anyway?')) return;
    }
    var whoEl = document.getElementById('eq-chk-who-' + id);
    var who = whoEl ? whoEl.value.trim() : '';
    var rec = {
      id: Date.now().toString(36),
      equipmentId: id,
      equipmentName: eq.name,
      date: new Date().toISOString(),
      checkedBy: who || 'Unknown',
      allItems: checked,
      skipped: unchecked
    };
    var all = EquipmentPage._allInspections();
    all.unshift(rec);
    localStorage.setItem('bm-equipment-inspections', JSON.stringify(all));
    UI.toast('✅ ' + eq.name + ' inspected (' + checked.length + '/' + items.length + ' items)');
    loadPage('equipment');
  }
};
