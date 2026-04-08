// render.js
// Zentrale Render-Funktionen. §4.9 Rendering-Strategie.
//
// Kontrakt:
// - renderAll() rendert alle sichtbaren Tabs neu (jede Tab-Render-Funktion in
//   eigenem try/catch via safeRender — §7.4).
// - Tab-Renderer lesen appData über getAppData() aus state.js.
// - Keine direkte State-Mutation; alle Änderungen laufen über updateAppData().

import { escapeHtml } from './validation.js';
import { getAppData } from './state.js';
import { getDriveStatus, DriveStatus } from './drive.js';

let _currentDetailPatientId = null;
let _lastRenderErrors = {}; // tabId → error
let _lastRenderDurationMs = 0;

export function setCurrentDetailPatientId(id) { _currentDetailPatientId = id; }
export function getCurrentDetailPatientId() { return _currentDetailPatientId; }
export function getLastRenderErrors() { return _lastRenderErrors; }
export function getLastRenderDurationMs() { return _lastRenderDurationMs; }

// ============ TAB NAVIGATION ============
export function showTab(tab) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.querySelectorAll('.tab-btn').forEach(b => {
    if (b.dataset.tab === tab) b.classList.add('active');
  });
  renderAll();
}

// ============ HELPERS ============
function getPatientSessions(patientId) {
  const data = getAppData();
  return data.sessions
    .filter(s => s.patientId === patientId)
    .sort((a, b) => b.date.localeCompare(a.date));
}

function getPatientSupervisions(patientId) {
  const data = getAppData();
  return data.supervisions
    .filter(s => s.patientIds && s.patientIds.includes(patientId))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function countSessionHours(patientId) {
  return getPatientSessions(patientId).reduce((sum, s) => sum + (s.duration / 50), 0);
}

export function countSupervisionHours(patientId) {
  return getPatientSupervisions(patientId).reduce((sum, s) => sum + (s.duration / 50), 0);
}

export function getSupervisionStatus(patientId) {
  const data = getAppData();
  const sessionHours = countSessionHours(patientId);
  const supervisionHours = countSupervisionHours(patientId);
  const ratio = data.settings.supervisionRatio;
  const required = sessionHours / ratio;
  const deficit = required - supervisionHours;
  return { sessionHours, supervisionHours, required, deficit, ratio };
}

function formatDate(dateStr) {
  if (!dateStr) return '–';
  const d = new Date(dateStr);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ============ TAB RENDERERS ============

export function renderDashboard() {
  const data = getAppData();
  const totalPatients = data.patients.length;
  const totalSessions = data.sessions.length;
  const totalSessionHours = data.sessions.reduce((sum, s) => sum + (s.duration / 50), 0);
  const totalSupervisionHours = data.supervisions.reduce((sum, s) => sum + (s.duration / 50), 0);

  document.getElementById('stats-grid').innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${totalPatients}</div>
      <div class="stat-label">Patienten</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${totalSessions}</div>
      <div class="stat-label">Sitzungen</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${totalSessionHours.toFixed(1)}</div>
      <div class="stat-label">Behandlungsstd.</div>
    </div>
    <div class="stat-card ${totalSupervisionHours < totalSessionHours / data.settings.supervisionRatio ? 'danger' : 'success'}">
      <div class="stat-value">${totalSupervisionHours.toFixed(1)}</div>
      <div class="stat-label">Supervisionsstd.</div>
    </div>
  `;

  let alertsHtml = '';
  const patientsWithDeficit = [];
  data.patients.forEach(p => {
    const status = getSupervisionStatus(p.id);
    if (status.deficit > 0 && status.sessionHours > 0) {
      patientsWithDeficit.push({ patient: p, ...status });
    }
  });

  if (patientsWithDeficit.length > 0) {
    alertsHtml += `<div class="alert alert-danger">
      <span class="alert-icon">⚠</span>
      <div><strong>${patientsWithDeficit.length} Patient(en)</strong> benötigen zusätzliche Supervisionsstunden, um das Verhältnis 1:${data.settings.supervisionRatio} einzuhalten.</div>
    </div>`;
  } else if (totalPatients > 0) {
    alertsHtml += `<div class="alert alert-success">
      <span class="alert-icon">✓</span>
      <div>Alle Supervisionsverhältnisse sind im grünen Bereich.</div>
    </div>`;
  }
  document.getElementById('dashboard-alerts').innerHTML = alertsHtml;

  let listHtml = '';
  if (totalPatients === 0) {
    listHtml = `<div class="empty-state">
      <div class="empty-state-icon">📋</div>
      <p>Noch keine Patienten angelegt.<br>Tippe auf + um zu starten.</p>
    </div>`;
  } else {
    data.patients.forEach(p => {
      const status = getSupervisionStatus(p.id);
      const kontingent = p.kontingent || data.settings.defaultKontingent;
      let badgeClass = 'badge-ok';
      let badgeText = 'OK';
      if (status.deficit > 0.5) { badgeClass = 'badge-danger'; badgeText = `−${status.deficit.toFixed(1)} SV`; }
      else if (status.deficit > 0) { badgeClass = 'badge-warn'; badgeText = `−${status.deficit.toFixed(1)} SV`; }

      listHtml += `
        <div class="patient-item" data-action="dashboard-open-patient" data-id="${p.id}">
          <div class="patient-info">
            <h3>${escapeHtml(p.name)}${p.kuerzel ? ' <span style="color:var(--gray-500);font-weight:400;">(' + escapeHtml(p.kuerzel) + ')</span>' : ''}</h3>
            <div class="patient-meta">
              ${status.sessionHours.toFixed(1)}/${kontingent}h${p.startDate ? ' · ab ' + formatDate(p.startDate) : ''}
            </div>
          </div>
          <span class="patient-badge ${badgeClass}">${badgeText}</span>
        </div>`;
    });
  }
  document.getElementById('dashboard-patient-list').innerHTML = listHtml;
}

export function renderPatientList() {
  const data = getAppData();
  let html = '';
  if (data.patients.length === 0) {
    html = `<div class="empty-state">
      <div class="empty-state-icon">👤</div>
      <p>Noch keine Patienten angelegt.<br>Tippe auf + um einen neuen Patienten hinzuzufügen.</p>
    </div>`;
  } else {
    data.patients.forEach(p => {
      const status = getSupervisionStatus(p.id);
      let badgeClass = 'badge-ok', badgeText = 'SV OK';
      if (status.deficit > 0.5) { badgeClass = 'badge-danger'; badgeText = `−${status.deficit.toFixed(1)} SV`; }
      else if (status.deficit > 0) { badgeClass = 'badge-warn'; badgeText = `−${status.deficit.toFixed(1)} SV`; }

      html += `
        <div class="patient-item" data-action="show-patient-detail" data-id="${p.id}">
          <div class="patient-info">
            <h3>${escapeHtml(p.name)}${p.kuerzel ? ' <span style="color:var(--gray-500);font-weight:400;">(' + escapeHtml(p.kuerzel) + ')</span>' : ''}</h3>
            <div class="patient-meta">
              ${status.sessionHours.toFixed(1)} / ${(p.kontingent || data.settings.defaultKontingent)} Std.${p.startDate ? ' · ab ' + formatDate(p.startDate) : ''}
            </div>
          </div>
          <span class="patient-badge ${badgeClass}">${badgeText}</span>
        </div>`;
    });
  }
  document.getElementById('patients-list').innerHTML = html;
}

export function showPatientListView() {
  _currentDetailPatientId = null;
  document.getElementById('patient-list-view').style.display = 'block';
  document.getElementById('patient-detail-view').style.display = 'none';
  renderPatientList();
}

export function showPatientDetail(patientId) {
  const data = getAppData();
  const p = data.patients.find(pt => pt.id === patientId);
  if (!p) return;
  _currentDetailPatientId = patientId;

  document.getElementById('patient-list-view').style.display = 'none';
  document.getElementById('patient-detail-view').style.display = 'block';

  const status = getSupervisionStatus(patientId);
  const sessions = getPatientSessions(patientId);
  const supervisions = getPatientSupervisions(patientId);
  const kontingent = p.kontingent || data.settings.defaultKontingent;
  const kontingentPct = kontingent > 0 ? Math.min(100, (status.sessionHours / kontingent) * 100) : 0;
  const svPct = status.required > 0 ? Math.min(100, (status.supervisionHours / status.required) * 100) : 100;

  let svBarColor = 'var(--success)';
  if (svPct < 70) svBarColor = 'var(--danger)';
  else if (svPct < 100) svBarColor = 'var(--warning)';

  const html = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <h2 style="font-size:1.2rem;">${escapeHtml(p.name)}${p.kuerzel ? ' <span style="color:var(--gray-500);font-weight:400;font-size:0.9rem;">(' + escapeHtml(p.kuerzel) + ')</span>' : ''}</h2>
          ${p.startDate ? `<div style="font-size:0.85rem;color:var(--gray-500);margin-top:4px;">Therapiebeginn: ${formatDate(p.startDate)}</div>` : ''}
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-outline btn-sm" data-action="edit-patient" data-id="${p.id}">Bearbeiten</button>
          <button class="btn btn-danger btn-sm" data-action="delete-patient" data-id="${p.id}">Löschen</button>
        </div>
      </div>
    </div>

    <div class="stats-grid" style="grid-template-columns: 1fr 1fr 1fr;">
      <div class="stat-card">
        <div class="stat-value">${status.sessionHours.toFixed(1)}</div>
        <div class="stat-label">Behandlungsstd.</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${status.supervisionHours.toFixed(1)}</div>
        <div class="stat-label">Supervisionsstd.</div>
      </div>
      <div class="stat-card ${status.deficit > 0 ? 'danger' : 'success'}">
        <div class="stat-value">${status.deficit > 0 ? '−' + status.deficit.toFixed(1) : '✓'}</div>
        <div class="stat-label">${status.deficit > 0 ? 'SV fehlen' : 'SV ausreichend'}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Kontingent</div>
      <div style="display:flex;justify-content:space-between;font-size:0.85rem;margin-bottom:4px;">
        <span>${status.sessionHours.toFixed(1)} von ${kontingent} Stunden</span>
        <span>${kontingentPct.toFixed(0)}%</span>
      </div>
      <div class="supervision-ratio-bar">
        <div class="supervision-ratio-fill" style="width:${kontingentPct}%;background:${kontingentPct > 90 ? 'var(--warning)' : 'var(--primary)'}"></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Supervisionsverhältnis (1:${status.ratio})</div>
      <div style="display:flex;justify-content:space-between;font-size:0.85rem;margin-bottom:4px;">
        <span>${status.supervisionHours.toFixed(1)} von ${status.required.toFixed(1)} benötigten Std.</span>
        <span>${svPct.toFixed(0)}%</span>
      </div>
      <div class="supervision-ratio-bar">
        <div class="supervision-ratio-fill" style="width:${svPct}%;background:${svBarColor}"></div>
      </div>
      ${status.deficit > 0 ? `<div class="alert alert-danger" style="margin-top:8px;margin-bottom:0;">
        <span class="alert-icon">⚠</span>
        <div>Es fehlen <strong>${status.deficit.toFixed(1)} Supervisionsstunden</strong> für diesen Patienten.</div>
      </div>` : ''}
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div class="card-title" style="margin-bottom:0;">Behandlungssitzungen (${sessions.length})</div>
        <button class="btn btn-primary btn-sm" data-action="open-session-modal-for" data-id="${p.id}">+ Sitzung</button>
      </div>
      ${sessions.length === 0 ? '<p style="font-size:0.85rem;color:var(--gray-500);">Noch keine Sitzungen.</p>' : ''}
      ${sessions.map(s => `
        <div class="session-item">
          <div>
            <span class="session-date">${formatDate(s.date)}</span>
            <span class="session-type"> · ${s.type === 'einzel' ? 'Einzelsitzung' : s.type === 'doppel' ? 'Doppelsitzung' : s.type === 'gruppe' ? 'Gruppe' : 'Probatorik'} · ${s.duration} Min.</span>
            ${s.note ? `<div style="font-size:0.78rem;color:var(--gray-500);">${escapeHtml(s.note)}</div>` : ''}
          </div>
          <button class="btn btn-outline btn-sm" data-action="delete-session" data-id="${s.id}" data-patient-id="${p.id}">×</button>
        </div>
      `).join('')}
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div class="card-title" style="margin-bottom:0;">Supervisionsstunden (${supervisions.length})</div>
        <button class="btn btn-primary btn-sm" data-action="open-supervision-modal-for" data-id="${p.id}">+ Supervision</button>
      </div>
      ${supervisions.length === 0 ? '<p style="font-size:0.85rem;color:var(--gray-500);">Noch keine Supervisionsstunden.</p>' : ''}
      ${supervisions.map(s => `
        <div class="session-item">
          <div>
            <span class="session-date">${formatDate(s.date)}</span>
            <span class="session-type"> · ${s.type === 'einzel' ? 'Einzel-SV' : 'Gruppen-SV'} · ${s.duration} Min.</span>
            ${s.supervisor ? `<div style="font-size:0.78rem;color:var(--gray-500);">SV: ${escapeHtml(s.supervisor)}</div>` : ''}
          </div>
          <button class="btn btn-outline btn-sm" data-action="delete-supervision" data-id="${s.id}" data-patient-id="${p.id}">×</button>
        </div>
      `).join('')}
    </div>
  `;

  document.getElementById('patient-detail-content').innerHTML = html;
}

export function renderSupervisionOverview() {
  const data = getAppData();
  const ratio = data.settings.supervisionRatio;
  let html = '';

  if (data.patients.length === 0) {
    html = `<div class="empty-state">
      <div class="empty-state-icon">📊</div>
      <p>Noch keine Patienten angelegt.</p>
    </div>`;
  } else {
    const totalSessionH = data.sessions.reduce((s, x) => s + x.duration / 50, 0);
    const totalSvH = data.supervisions.reduce((s, x) => s + x.duration / 50, 0);
    const totalRequired = totalSessionH / ratio;
    const overallPct = totalRequired > 0 ? Math.min(100, (totalSvH / totalRequired) * 100) : 100;
    let overallColor = 'var(--success)';
    if (overallPct < 70) overallColor = 'var(--danger)';
    else if (overallPct < 100) overallColor = 'var(--warning)';

    html += `<div class="card">
      <div class="card-title">Gesamtübersicht Supervision</div>
      <div style="display:flex;justify-content:space-between;font-size:0.85rem;">
        <span>Gesamt: ${totalSvH.toFixed(1)} von ${totalRequired.toFixed(1)} benötigten Std.</span>
        <span style="font-weight:600;color:${overallColor}">${overallPct.toFixed(0)}%</span>
      </div>
      <div class="supervision-ratio-bar">
        <div class="supervision-ratio-fill" style="width:${overallPct}%;background:${overallColor}"></div>
      </div>
      <div style="font-size:0.8rem;color:var(--gray-500);margin-top:8px;">
        Vorgabe: 1 Supervisionsstunde pro ${ratio} Behandlungsstunden
      </div>
    </div>`;

    html += `<div class="card"><div class="card-title">Supervision pro Patient</div>`;
    data.patients.forEach(p => {
      const status = getSupervisionStatus(p.id);
      const pct = status.required > 0 ? Math.min(100, (status.supervisionHours / status.required) * 100) : 100;
      let color = 'var(--success)';
      if (pct < 70) color = 'var(--danger)';
      else if (pct < 100) color = 'var(--warning)';

      html += `
        <div style="margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong style="font-size:0.9rem;">${escapeHtml(p.name)}</strong>
            <span style="font-size:0.8rem;color:${color};font-weight:600;">
              ${status.supervisionHours.toFixed(1)} / ${status.required.toFixed(1)} Std.
              ${status.deficit > 0 ? ` (−${status.deficit.toFixed(1)})` : ' ✓'}
            </span>
          </div>
          <div class="supervision-ratio-bar">
            <div class="supervision-ratio-fill" style="width:${pct}%;background:${color}"></div>
          </div>
          <div style="font-size:0.78rem;color:var(--gray-500);">
            ${status.sessionHours.toFixed(1)} Behandlungsstd. → ${status.required.toFixed(1)} SV-Std. benötigt
          </div>
        </div>`;
    });
    html += `</div>`;

    const allSv = [...data.supervisions].sort((a, b) => b.date.localeCompare(a.date));
    if (allSv.length > 0) {
      html += `<div class="card"><div class="card-title">Alle Supervisionsstunden (${allSv.length})</div>`;
      allSv.forEach(s => {
        const patientNames = (s.patientIds || []).map(id => {
          const p = data.patients.find(pt => pt.id === id);
          return p ? escapeHtml(p.name) : '?';
        }).join(', ');
        html += `
          <div class="session-item">
            <div>
              <span class="session-date">${formatDate(s.date)}</span>
              <span class="session-type"> · ${s.type === 'einzel' ? 'Einzel' : 'Gruppe'} · ${s.duration} Min.</span>
              <div style="font-size:0.78rem;color:var(--gray-500);">
                ${patientNames}${s.supervisor ? ' · SV: ' + escapeHtml(s.supervisor) : ''}
              </div>
            </div>
            <button class="btn btn-outline btn-sm" data-action="delete-supervision-global" data-id="${s.id}">×</button>
          </div>`;
      });
      html += `</div>`;
    }
  }

  document.getElementById('supervision-overview').innerHTML = html;
}

export function renderGroupsList() {
  const data = getAppData();
  const container = document.getElementById('groups-list');
  const groups = data.supervisionGroups || [];

  if (groups.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👥</div><p>Noch keine Supervisionsgruppen angelegt.</p></div>';
    return;
  }

  let html = '';
  groups.forEach(g => {
    const patientNames = (g.patientIds || [])
      .map(id => {
        const p = data.patients.find(pt => pt.id === id);
        return p ? escapeHtml(p.name) : null;
      })
      .filter(n => n !== null);

    html += '<div class="patient-item" style="cursor:default;">' +
      '<div class="patient-info">' +
        '<h3>' + escapeHtml(g.name) + '</h3>' +
        '<div class="patient-meta">' +
          (g.supervisor ? 'SV: ' + escapeHtml(g.supervisor) + ' · ' : '') +
          patientNames.length + ' Patienten: ' + patientNames.join(', ') +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:6px;">' +
        '<button class="btn btn-outline btn-sm" data-action="edit-group" data-id="' + g.id + '">Bearb.</button>' +
        '<button class="btn btn-danger btn-sm" data-action="delete-group" data-id="' + g.id + '">×</button>' +
      '</div>' +
    '</div>';
  });
  container.innerHTML = html;
}

export function renderDataTab() {
  const container = document.getElementById('drive-status-container');
  if (!container) return;
  const { status, detail, lastSyncAt } = getDriveStatus();
  const labels = {
    [DriveStatus.UNCONFIGURED]: 'Drive nicht konfiguriert',
    [DriveStatus.INITIALIZING]: 'Drive lädt…',
    [DriveStatus.UNAUTHORIZED]: 'Nicht angemeldet',
    [DriveStatus.READY]: 'Bereit',
    [DriveStatus.SYNCING]: 'Synchronisiere…',
    [DriveStatus.ERROR]: 'Fehler',
    [DriveStatus.OFFLINE]: 'Offline',
  };
  const label = labels[status] || status;
  const lastSyncText = lastSyncAt ? `Letzter Sync: ${new Date(lastSyncAt).toLocaleString('de-DE')}` : 'Noch kein Sync';
  container.innerHTML =
    `<div class="drive-status ${status}">${escapeHtml(label)}</div>` +
    `<div style="font-size:0.75rem;color:var(--gray-500);margin-top:4px;">${escapeHtml(lastSyncText)}${detail ? ' · ' + escapeHtml(detail) : ''}</div>`;
}

function safeRender(tabId, fn) {
  try {
    fn();
    if (_lastRenderErrors[tabId]) delete _lastRenderErrors[tabId];
  } catch (err) {
    _lastRenderErrors[tabId] = { message: err?.message || String(err), at: new Date().toISOString() };
    console.error(`[render] tab "${tabId}" failed:`, err);
    const container = document.getElementById('tab-' + tabId);
    if (container) {
      container.innerHTML = '<div class="card" style="border:1px solid var(--danger-light);"><div class="card-title" style="color:var(--danger);">Fehler in diesem Bereich</div><p style="font-size:0.85rem;color:var(--gray-500);">Bitte JSON-Export über den Daten-Tab nutzen und Admin kontaktieren. Details im Diagnose-Panel.</p></div>';
    }
  }
}

export function renderAll() {
  const start = performance.now();
  safeRender('dashboard', renderDashboard);
  safeRender('patients', () => {
    if (_currentDetailPatientId && document.getElementById('patient-detail-view').style.display !== 'none') {
      showPatientDetail(_currentDetailPatientId);
    } else {
      renderPatientList();
    }
  });
  safeRender('supervision', renderSupervisionOverview);
  safeRender('groups', renderGroupsList);
  safeRender('data', renderDataTab);
  _lastRenderDurationMs = performance.now() - start;
}

// ============ TOAST & CONFIRM ============
let _toastTimer = null;
export function showToast(message, type) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.display = 'block';
  toast.style.opacity = '1';
  if (type === 'success') { toast.style.background = 'var(--success)'; toast.style.color = 'white'; }
  else if (type === 'danger') { toast.style.background = 'var(--danger)'; toast.style.color = 'white'; }
  else if (type === 'warning') { toast.style.background = 'var(--warning)'; toast.style.color = 'white'; }
  else { toast.style.background = 'var(--gray-700)'; toast.style.color = 'white'; }

  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => { toast.style.display = 'none'; }, 300);
  }, 2500);
}

export function showConfirmDialog(message, onConfirm) {
  document.getElementById('confirm-message').textContent = message;
  const okBtn = document.getElementById('confirm-ok-btn');
  const newBtn = okBtn.cloneNode(true);
  okBtn.parentNode.replaceChild(newBtn, okBtn);
  newBtn.id = 'confirm-ok-btn';
  newBtn.addEventListener('click', () => {
    closeModal('modal-confirm');
    onConfirm();
  });
  openModal('modal-confirm');
}

export function openModal(id) { document.getElementById(id).classList.add('active'); }
export function closeModal(id) { document.getElementById(id).classList.remove('active'); }
