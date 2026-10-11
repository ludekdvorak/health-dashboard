(() => {
  const STORE = { sleep: 'mojezdravi.sleep.v1', activity: 'mojezdravi.activity.v1', weight: 'mojezdravi.weight.v1', imports: 'mojezdravi.imports.v1' };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const readStore = (key) => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } };
  let dataDirectoryHandle = null, fileStorageActive = false, fileSaveQueue = Promise.resolve(), appDataLoaded = false;
  function setStorageStatus(label, state = 'ready') {
    const button = $('#storage-folder-button'), status = $('#storage-status');
    const fileMode = location.protocol === 'file:';
    if (button && fileMode && !fileStorageActive) { button.title = 'Načíst health-data.json'; label = appDataLoaded ? 'Data lokálně' : 'Načíst JSON'; }
    else if (button && state === 'data-error') { button.title = 'Vybrat health-data.json ručně'; label = 'Načíst JSON'; }
    if (button) button.dataset.state = state;
    if (status) status.textContent = label;
    const notice = $('#storage-notice'), noticeText = $('#storage-notice-text'), noticeAction = $('#storage-notice-action');
    const needsFolder = state === 'error' || state === 'data-error' || (!fileStorageActive && state !== 'saving' && !appDataLoaded);
    if (notice) {
      notice.classList.toggle('hidden', !needsFolder);
      notice.dataset.state = state;
    }
    if (noticeText) {
      noticeText.textContent = state === 'error'
        ? 'Nepodařilo se otevřít datový soubor. Zkontroluj přístup a vyber složku znovu.'
        : state === 'data-error'
          ? 'Načtení health-data.json ze složky serveru selhalo. Otevři server ve složce projektu, nebo soubor načti ručně na stránce Import dat.'
        : dataDirectoryHandle
          ? 'Datová složka je uložená, ale prohlížeč potřebuje obnovit přístup. Klikni na tlačítko a potvrď oprávnění.'
        : fileMode
          ? 'Bez serveru vyber health-data.json jednou. Stránka si jej uloží v tomto prohlížeči a příště ho obnoví automaticky.'
          : 'Data se zatím ukládají jen do tohoto profilu prohlížeče. Připoj složku, aby se ukládala do health-data.json a šla znovu načíst.';
    }
    if (noticeAction) noticeAction.textContent = state === 'data-error' ? 'Vybrat health-data.json' : fileMode && !fileStorageActive ? (appDataLoaded ? 'Načíst jiný JSON' : 'Vybrat health-data.json') : state === 'error' ? 'Vybrat složku znovu' : dataDirectoryHandle ? 'Obnovit přístup' : 'Připojit složku';
    const privacyText = $('.privacy-card div span');
    if (privacyText) privacyText.textContent = fileStorageActive ? `Soubor health-data.json · ${dataDirectoryHandle.name}` : 'Zatím pouze v tomto prohlížeči.';
    const footerLabel = state === 'ready' && fileStorageActive ? 'Uloženo do health-data.json' : state === 'saving' ? 'Ukládám health-data.json…' : state === 'error' ? 'Chyba ukládání' : dataDirectoryHandle ? 'Čeká na přístup ke složce' : 'Uloženo v tomto prohlížeči';
    $$('.page-footer > span:last-child').forEach((footer) => footer.replaceChildren(Object.assign(document.createElement('i'), { }), document.createTextNode(footerLabel)));
  }
  function dataFileContents() {
    return { schemaVersion: 1, updatedAt: new Date().toISOString(), sleepRecords, activityRecords, weightRecords, importRecords };
  }
  async function saveDataFile() {
    if (!fileStorageActive || !dataDirectoryHandle) return;
    setStorageStatus(`Ukládám do ${dataDirectoryHandle.name}…`, 'saving');
    const fileHandle = await dataDirectoryHandle.getFileHandle('health-data.json', { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(dataFileContents(), null, 2));
    await writable.close();
    setStorageStatus(`health-data.json · ${dataDirectoryHandle.name}`, 'ready');
  }
  function writeStore(key, value) {
    if (!fileStorageActive) { localStorage.setItem(key, JSON.stringify(value)); return; }
    fileSaveQueue = fileSaveQueue.catch(() => {}).then(saveDataFile).catch((error) => {
      console.error('Nepodařilo se uložit health-data.json', error);
      setStorageStatus('Chyba ukládání · klikni pro opravu', 'error');
      showToast('Nepodařilo se uložit health-data.json. Zkontroluj přístup ke složce.');
    });
  }
  function openHandleDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('moje-zdravi-file-handles', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('settings');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function loadSavedDirectoryHandle() {
    const db = await openHandleDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction('settings', 'readonly').objectStore('settings').get('data-directory');
      request.onsuccess = () => { db.close(); resolve(request.result || null); };
      request.onerror = () => { db.close(); reject(request.error); };
    });
  }
  async function saveDirectoryHandle(handle) {
    const db = await openHandleDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('settings', 'readwrite');
      transaction.objectStore('settings').put(handle, 'data-directory');
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    });
  }
  async function readDataFile(handle) {
    try {
      const fileHandle = await handle.getFileHandle('health-data.json');
      const file = await fileHandle.getFile();
      if (!file.size) return null;
      const data = JSON.parse(await file.text());
      if (!data || typeof data !== 'object') throw new Error('Soubor health-data.json nemá správný formát.');
      return data;
    } catch (error) {
      if (error.name === 'NotFoundError') return null;
      throw error;
    }
  }
  function mergeWeightRecord(incoming) {
    const duplicate = weightRecords.find((record) => record.id === incoming.id || (record.measuredAt === incoming.measuredAt && String(record.weight) === String(incoming.weight) && String(record.bmi) === String(incoming.bmi)));
    if (!duplicate) { weightRecords.push(incoming); return; }
    for (const [key, value] of Object.entries(incoming)) if ((duplicate[key] === null || duplicate[key] === undefined || duplicate[key] === '') && value !== null && value !== undefined && value !== '') duplicate[key] = value;
  }
  function mergeImportHistory(incoming = []) {
    const known = new Set(importRecords.map((item) => `${item.fileName}|${item.dateLabel}`));
    for (const item of incoming) {
      const key = `${item.fileName}|${item.dateLabel}`;
      if (!known.has(key)) { importRecords.push(item); known.add(key); }
    }
    importRecords = importRecords.slice(0, 100);
  }
  async function hydrateFromAppDataFile() {
    if (location.protocol === 'file:') return false;
    try {
      const response = await fetch(new URL('./health-data.json', location.href), { cache: 'no-store' });
      if (!response.ok) { setStorageStatus('Načíst JSON', 'data-error'); return false; }
      const data = await response.json();
      if (!data || typeof data !== 'object' || !Array.isArray(data.sleepRecords)) { setStorageStatus('Načíst JSON', 'data-error'); return false; }
      const hadSleep = sleepRecords.some(isSleepRecord);
      (Array.isArray(data.sleepRecords) ? data.sleepRecords : []).forEach(upsertDailyRecord);
      (Array.isArray(data.activityRecords) ? data.activityRecords : []).forEach(upsertActivityRecord);
      (Array.isArray(data.weightRecords) ? data.weightRecords : []).forEach(mergeWeightRecord);
      mergeImportHistory(Array.isArray(data.importRecords) ? data.importRecords : []);
      normalizeStoredActivities();
      normalizeStoredSleepDurations();
      if (fileStorageActive) await saveDataFile();
      else {
        localStorage.setItem(STORE.sleep, JSON.stringify(sleepRecords));
        localStorage.setItem(STORE.activity, JSON.stringify(activityRecords));
        localStorage.setItem(STORE.weight, JSON.stringify(weightRecords));
        localStorage.setItem(STORE.imports, JSON.stringify(importRecords));
      }
      appDataLoaded = true;
      renderImports();
      updateDashboard();
      const batteryDays = sleepRecords.filter((r) => r.date >= getRange().start && r.date <= getRange().end && (r.bodyBatteryCharged != null || r.bodyBatteryDrained != null)).length;
      setStorageStatus(`Načteno · ${sleepRecords.length} dnů`, 'ready');
      if (!batteryDays) showToast('health-data.json se načetl, ale ve zvoleném období nejsou záznamy Body Battery. Zkus delší období.');
      if (!hadSleep && sleepRecords.some(isSleepRecord)) showToast('Spánková data byla načtena z health-data.json vedle aplikace.');
      return true;
    } catch (error) {
      console.warn('health-data.json vedle aplikace se nepodařilo načíst', error);
      return false;
    }
  }
  function mergeAppData(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Soubor nemá očekávaný formát health-data.json.');
    const hadSleep = sleepRecords.some(isSleepRecord);
    (Array.isArray(data.sleepRecords) ? data.sleepRecords : []).forEach(upsertDailyRecord);
    (Array.isArray(data.activityRecords) ? data.activityRecords : []).forEach(upsertActivityRecord);
    (Array.isArray(data.weightRecords) ? data.weightRecords : []).forEach(mergeWeightRecord);
    mergeImportHistory(Array.isArray(data.importRecords) ? data.importRecords : []);
    normalizeStoredActivities();
    normalizeStoredSleepDurations();
    appDataLoaded = true;
    for (const [store, value] of [[STORE.sleep, sleepRecords], [STORE.activity, activityRecords], [STORE.weight, weightRecords], [STORE.imports, importRecords]]) writeStore(store, value);
    renderImports(); updateDashboard();
    setStorageStatus('Data uložena lokálně', 'ready');
    if (!hadSleep && sleepRecords.some(isSleepRecord)) showToast('Zdravotní data byla načtena a uložená v tomto prohlížeči.');
  }
  async function loadAppDataFile(file) {
    try {
      mergeAppData(JSON.parse((await file.text()).replace(/^\uFEFF/, '')));
      showImportMessage(`Načteno ${file.name}. Data se po tomto prvním výběru obnoví z úložiště prohlížeče.`, false);
    } catch (error) {
      showImportMessage(error.message || 'Soubor se nepodařilo načíst.', true);
    }
  }
  async function activateDataDirectory(handle) {
    const legacy = { sleepRecords: [...sleepRecords], activityRecords: [...activityRecords], weightRecords: [...weightRecords], importRecords: [...importRecords] };
    const saved = await readDataFile(handle);
    if (saved) {
      sleepRecords = Array.isArray(saved.sleepRecords) ? saved.sleepRecords : [];
      activityRecords = Array.isArray(saved.activityRecords) ? saved.activityRecords : [];
      weightRecords = Array.isArray(saved.weightRecords) ? saved.weightRecords : [];
      importRecords = Array.isArray(saved.importRecords) ? saved.importRecords : [];
      legacy.sleepRecords.forEach(upsertDailyRecord);
      legacy.activityRecords.forEach(upsertActivityRecord);
      legacy.weightRecords.forEach(mergeWeightRecord);
      mergeImportHistory(legacy.importRecords);
    }
    normalizeStoredActivities();
    normalizeStoredSleepDurations();
    dataDirectoryHandle = handle;
    fileStorageActive = true;
    await saveDataFile();
    await saveDirectoryHandle(handle);
    for (const key of Object.values(STORE)) localStorage.removeItem(key);
    renderImports(); updateDashboard();
    setStorageStatus(`health-data.json · ${handle.name}`, 'ready');
    showToast('Datová složka je připojená. Data se ukládají do health-data.json.');
  }
  async function initializeDataDirectory() {
    try {
      const handle = await loadSavedDirectoryHandle();
      if (!handle) { setStorageStatus('Připojit datovou složku', 'local'); return; }
      dataDirectoryHandle = handle;
      const permission = await handle.queryPermission({ mode: 'readwrite' });
      if (permission === 'granted') await activateDataDirectory(handle);
      else setStorageStatus('Obnovit přístup ke složce', 'local');
    } catch (error) {
      console.error('Nepodařilo se otevřít datovou složku', error);
      dataDirectoryHandle = null;
      fileStorageActive = false;
      setStorageStatus('Připojit datovou složku', 'error');
    }
  }
  async function connectDataDirectory() {
    if (!window.showDirectoryPicker) {
      setStorageStatus('Použij Chrome nebo Edge', 'error');
      showToast('Přímé ukládání do složky podporuje Chrome nebo Edge.');
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      await activateDataDirectory(handle);
      await hydrateFromAppDataFile();
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Nepodařilo se připojit datovou složku', error);
        dataDirectoryHandle = null;
        fileStorageActive = false;
        setStorageStatus('Připojit datovou složku', 'error');
        showToast('Složku se nepodařilo připojit. Zkus ji vybrat znovu.');
      }
    }
  }
  function chooseDataSource() {
    if ((location.protocol === 'file:' && !fileStorageActive) || $('#storage-folder-button').dataset.state === 'data-error') { $('#app-json-input').click(); return; }
    connectDataDirectory();
  }
  let sleepRecords = readStore(STORE.sleep);
  let activityRecords = readStore(STORE.activity);
  let weightRecords = readStore(STORE.weight);
  let importRecords = readStore(STORE.imports);
  appDataLoaded = sleepRecords.length + activityRecords.length + weightRecords.length > 0;
  let toastTimer;

  const monthMap = { led: 0, uno: 1, bre: 2, dub: 3, kve: 4, cvn: 5, cvc: 6, srp: 7, zar: 8, rij: 9, lis: 10, pro: 11 };
  const metricInfo = {
    sleepScore: { label: 'Skóre spánku', unit: 'bodů', format: (v) => `${Math.round(v)}` },
    sleepDuration: { label: 'Délka spánku', unit: 'h', format: (v) => `${(v / 60).toFixed(1)} h` },
    restingHr: { label: 'Klidový tep', unit: 't/min.', format: (v) => `${Math.round(v)} t/min.` },
    steps: { label: 'Kroky', unit: 'kroků', format: (v) => Math.round(v).toLocaleString('cs-CZ') },
    stress: { label: 'Stres ve spánku', unit: 'bodů', format: (v) => `${Math.round(v)}` },
    spo2Avg: { label: 'Průměrné SpO₂', unit: '%', format: (v) => `${v.toFixed(1)} %` },
    bodyBatteryChange: { label: 'Změna Body Battery', unit: 'bodů', format: (v) => `${Math.round(v)} bodů` },
    deepSleep: { label: 'Hluboký spánek', unit: 'min', format: (v) => fmtDuration(v) },
    lightSleep: { label: 'Lehký spánek', unit: 'min', format: (v) => fmtDuration(v) },
    remSleep: { label: 'REM spánek', unit: 'min', format: (v) => fmtDuration(v) },
    breathingAvg: { label: 'Dýchání', unit: 'brpm', format: (v) => `${v.toFixed(1)} brpm` },
    totalCalories: { label: 'Celkem kalorií', unit: 'kcal', format: (v) => `${Math.round(v).toLocaleString('cs-CZ')} kcal` },
    activeCalories: { label: 'Aktivní kalorie', unit: 'kcal', format: (v) => `${Math.round(v).toLocaleString('cs-CZ')} kcal` },
    hydrationMl: { label: 'Vypitá voda', unit: 'ml', format: (v) => `${Math.round(v).toLocaleString('cs-CZ')} ml` },
    trainingLoad: { label: 'Akutní tréninková zátěž', unit: '', format: (v) => `${Math.round(v)}` },
    chronicTrainingLoad: { label: 'Dlouhodobá tréninková zátěž', unit: '', format: (v) => `${Math.round(v)}` },
    vo2Max: { label: 'VO₂ max', unit: 'ml/kg/min', format: (v) => `${v.toFixed(1)} ml/kg/min` },
    fitnessAge: { label: 'Fitness věk', unit: 'let', format: (v) => `${v.toFixed(1)} let` },
    heatAcclimation: { label: 'Aklimatizace na teplo', unit: '%', format: (v) => `${v.toFixed(0)} %` },
    altitudeAcclimation: { label: 'Aklimatizace na výšku', unit: '', format: (v) => `${v.toFixed(0)}` },
    activeSeconds: { label: 'Aktivní čas', unit: 'h', format: (v) => `${(v / 3600).toFixed(1)} h` },
    floorsAscended: { label: 'Převýšení dne', unit: 'm', format: (v) => `${Math.round(v)} m` },
  };

  function showToast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }
  function esc(value) { return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]); }
  function normalize(value) { return String(value ?? '').trim().toLocaleLowerCase('cs-CZ').replace(/^['"]|['"]$/g, '').replace(/₂/g, '2').replace(/₃/g, '3').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' '); }
  function numberValue(value) {
    const found = String(value ?? '').replace(',', '.').match(/[-+]?\d+(?:\.\d+)?/);
    return found ? Number(found[0]) : null;
  }
  function durationMinutes(value) {
    const str = String(value ?? '').trim().toLocaleLowerCase('cs-CZ');
    const hours = str.match(/(\d+)\s*h/);
    const minutes = str.match(/(\d+)\s*m(?:in)?/);
    if (hours || minutes) return Number(hours?.[1] || 0) * 60 + Number(minutes?.[1] || 0);
    const czech = str.match(/(\d+)\s*hod(?:in)?\.?\s*(\d+)\s*min/);
    if (czech) return Number(czech[1]) * 60 + Number(czech[2]);
    return numberValue(str);
  }
  function activityNumber(value) {
    const raw = String(value ?? '').trim();
    if (!raw || raw === '--') return null;
    const cleaned = /^[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(raw) ? raw.replace(/,/g, '') : raw.replace(',', '.');
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  function durationSeconds(value) {
    const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/);
    if (!match) return null;
    if (match[3] !== undefined) return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4] || 0}`);
    return Number(match[1]) * 60 + Number(match[2]);
  }
  function toDateInputValue(date) {
    const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  }
  function localDateString(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
  function parseCsv(text) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    const delimiter = (text.split(/\r?\n/, 1)[0].match(/;/g) || []).length > (text.split(/\r?\n/, 1)[0].match(/,/g) || []).length ? ';' : ',';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"' && quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = !quoted;
      else if (ch === delimiter && !quoted) { row.push(cell.trim()); cell = ''; }
      else if ((ch === '\n' || ch === '\r') && !quoted) {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell.trim()); cell = '';
        if (row.some((item) => item !== '')) rows.push(row);
        row = [];
      } else cell += ch;
    }
    row.push(cell.trim());
    if (row.some((item) => item !== '')) rows.push(row);
    return rows;
  }
  function parseCzechDate(value) {
    const s = String(value ?? '').trim();
    const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
    const local = s.match(/^(\d{1,2})[.\s]+(\d{1,2})[.\s]+(\d{4})/);
    if (local) return `${local[3]}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}`;
    return null;
  }
  function dateFromCzechMonth(month, day, year) {
    const key = normalize(month).replace(/\.$/, '').slice(0, 3);
    const monthIndex = monthMap[key];
    if (monthIndex === undefined) return null;
    const date = new Date(year, monthIndex, day);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function parseWeeklyRange(label) {
    const parts = String(label).match(/^\s*([\p{L}]{3,})\s+(\d{1,2})\s*(?:-|–)\s*(?:([\p{L}]{3,})\s*)?(\d{1,2})\s*$/u);
    if (!parts) return null;
    const now = new Date();
    const startMonthKey = normalize(parts[1]).replace(/\.$/, '').slice(0, 3);
    const endMonthKey = normalize(parts[3] || parts[1]).replace(/\.$/, '').slice(0, 3);
    const startMonth = monthMap[startMonthKey], endMonth = monthMap[endMonthKey];
    if (startMonth === undefined || endMonth === undefined) return null;
    let year = now.getFullYear();
    if (startMonth > endMonth) year--;
    const start = dateFromCzechMonth(parts[1], Number(parts[2]), year);
    const end = dateFromCzechMonth(parts[3] || parts[1], Number(parts[4]), year);
    if (!start || !end) return null;
    return { startDate: start, date: end, periodLabel: label.trim() };
  }
  function parseDailyReport(rows, fileName) {
    const values = new Map();
    for (const row of rows) {
      if (!row[0]) continue;
      const key = normalize(row[0]);
      const value = String(row.slice(1).join(',')).trim();
      if (value && value !== '--') values.set(key, value);
    }
    const date = parseCzechDate(values.get('datum'));
    if (!date) return null;
    const record = { type: 'daily', date, source: fileName };
    const map = [
      ['sleepDuration', ['doba trvani spanku'], durationMinutes],
      ['sleepScore', ['skore spanku'], numberValue],
      ['sleepQuality', ['kvalita'], (v) => v],
      ['stress', ['stres prumer'], numberValue],
      ['deepSleep', ['delka hlubokeho spanku'], durationMinutes],
      ['lightSleep', ['delka lehkeho spanku'], durationMinutes],
      ['remSleep', ['delka spanku rem'], durationMinutes],
      ['awakeDuration', ['doba bdělosti', 'doba bdělosti', 'doba bdelosti'], durationMinutes],
      ['restlessMoments', ['chvilky neklidu'], numberValue],
      ['restingHr', ['klidovy srdecni tep'], numberValue],
      ['bodyBatteryChange', ['zmena body battery'], numberValue],
      ['spo2Avg', ['prumer spo2'], numberValue],
      ['spo2Min', ['nejnizsi spo2'], numberValue],
      ['breathingAvg', ['prumerne dychani'], numberValue],
      ['breathingMin', ['nejnizsi dechova frekvence'], numberValue],
    ];
    for (const [field, aliases, parse] of map) {
      const entry = [...values.entries()].find(([key]) => aliases.some((alias) => key === normalize(alias)));
      if (entry) {
        const parsed = parse(entry[1]);
        if (parsed !== null && parsed !== undefined) record[field] = parsed;
      }
    }
    if (record.sleepScore === undefined && record.sleepDuration === undefined) return null;
    return record;
  }
  function parseWeeklyReport(rows, fileName) {
    const headerIndex = rows.findIndex((row) => normalize(row[0]) === 'datum' && row.length >= 3);
    if (headerIndex < 0) return [];
    const headers = rows[headerIndex].map(normalize);
    const found = [];
    for (const row of rows.slice(headerIndex + 1)) {
      if (normalize(row[0]) === 'datum' || row.length < 2) continue;
      const period = parseWeeklyRange(row[0]);
      if (!period) continue;
      const get = (aliases) => {
        const index = headers.findIndex((h) => aliases.includes(h));
        return index >= 0 ? row[index] : '';
      };
      const record = { type: 'weekly', ...period, source: fileName };
      const score = numberValue(get(['pr. skore', 'pr skore', 'prumerne skore']));
      const duration = durationMinutes(get(['prumerna delka', 'prumerna delka spanku']));
      const quality = get(['prumerna kvalita']);
      if (score !== null) record.sleepScore = score;
      if (duration !== null) record.sleepDuration = duration;
      if (quality && quality !== '--') record.sleepQuality = quality;
      if (record.sleepScore !== undefined || record.sleepDuration !== undefined) found.push(record);
    }
    return found;
  }
  function parseSleepCsv(text, fileName) {
    const rows = parseCsv(text.replace(/^\uFEFF/, ''));
    const daily = parseDailyReport(rows, fileName);
    if (daily) return [daily];
    return parseWeeklyReport(rows, fileName);
  }
  function parseActivityCsv(text, fileName) {
    const rows = parseCsv(text.replace(/^\uFEFF/, ''));
    if (!rows.length) return [];
    const headers = rows[0].map(normalize);
    const at = (names) => headers.findIndex((header) => names.includes(header));
    const ix = {
      type: at(['typ aktivity']), date: at(['datum']), name: at(['nazev']), distance: at(['vzdalenost']), calories: at(['kalorie (kcal)', 'kalorie']),
      duration: at(['cas']), avgHr: at(['prumerny st']), maxHr: at(['maximalni st']), aerobicTe: at(['aerobni te']), pace: at(['prumerne tempo']), bestPace: at(['nejlepsi tempo']),
      ascent: at(['celkovy vystup']), descent: at(['celkovy sestup']), steps: at(['kroky']), maxTemp: at(['maximalni teplota']), moving: at(['cas pohybu']), elapsed: at(['uplynuly cas']),
    };
    if (ix.type < 0 || ix.date < 0 || ix.distance < 0) return [];
    const get = (row, key) => ix[key] < 0 ? '' : (row[ix[key]] || '');
    const paceSeconds = (value) => {
      const match = String(value || '').match(/^(\d+):(\d{2})$/);
      return match ? Number(match[1]) * 60 + Number(match[2]) : null;
    };
    return rows.slice(1).flatMap((row) => {
      const rawDate = get(row, 'date'), date = parseCzechDate(rawDate);
      if (!date) return [];
      const time = rawDate.match(/\b(\d{2}:\d{2}:\d{2})\b/)?.[1] || '';
      const record = {
        id: `${date}|${time}|${get(row, 'type')}|${get(row, 'name')}|${get(row, 'duration')}`,
        date, time, type: get(row, 'type') || 'Aktivita', name: get(row, 'name') || get(row, 'type') || 'Aktivita', source: fileName,
        distance: activityNumber(get(row, 'distance')), calories: activityNumber(get(row, 'calories')), duration: durationSeconds(get(row, 'duration')),
        avgHr: activityNumber(get(row, 'avgHr')), maxHr: activityNumber(get(row, 'maxHr')), aerobicTe: activityNumber(get(row, 'aerobicTe')),
        pace: paceSeconds(get(row, 'pace')), bestPace: paceSeconds(get(row, 'bestPace')), ascent: activityNumber(get(row, 'ascent')),
        descent: activityNumber(get(row, 'descent')), steps: activityNumber(get(row, 'steps')), maxTemperature: activityNumber(get(row, 'maxTemp')),
        moving: durationSeconds(get(row, 'moving')), elapsed: durationSeconds(get(row, 'elapsed')),
      };
      return record.distance === null ? [] : [record];
    });
  }
  function jsonNumber(value) {
    const number = Number(value);
    return value !== null && value !== undefined && value !== '' && Number.isFinite(number) ? number : null;
  }
  function jsonDate(value) {
    if (typeof value === 'number' || /^\d{10,13}$/.test(String(value || ''))) {
      let timestamp = Number(value);
      if (timestamp < 100000000000) timestamp *= 1000;
      return localDateString(new Date(timestamp));
    }
    return parseCzechDate(value);
  }
  function activityTypeName(activity) {
    const raw = activity.activityType?.typeKey || activity.sportType || activity.activityType?.typeName || activity.activityType || 'Aktivita';
    const key = String(raw).toLocaleLowerCase('en-US');
    const names = { running: 'Běh', trail_running: 'Trailový běh', walking: 'Chůze', hiking: 'Turistika', cycling: 'Cyklistika', swimming: 'Plavání', strength_training: 'Posilování', fitness_equipment: 'Kardio', yoga: 'Jóga' };
    return names[key] || String(raw).replaceAll('_', ' ');
  }
  function parseGarminActivityJson(data, fileName) {
    const rows = Array.isArray(data) ? data.flatMap((item) => Array.isArray(item?.summarizedActivitiesExport) ? item.summarizedActivitiesExport : []) : [];
    return rows.flatMap((activity) => {
      const timestamp = jsonNumber(activity.startTimeLocal ?? activity.beginTimestamp ?? activity.startTimeGmt);
      if (!timestamp) return [];
      const date = jsonDate(timestamp), local = new Date(timestamp < 100000000000 ? timestamp * 1000 : timestamp);
      const rawDistance = jsonNumber(activity.distance), rawDuration = jsonNumber(activity.duration);
      if (!date || rawDistance === null || rawDuration === null) return [];
      const time = `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}:${String(local.getSeconds()).padStart(2, '0')}`;
      // Garmin's summarizedActivitiesExport stores these fields in scaled units:
      // distance is centimetres, duration milliseconds, speed decimetres/second.
      const distance = rawDistance / 100000;
      const duration = rawDuration / 1000;
      const avgSpeed = jsonNumber(activity.avgSpeed);
      const speedMps = avgSpeed === null ? null : avgSpeed * 10;
      return [{
        id: activity.activityId ? `garmin:${activity.activityId}` : `${date}|${time}|${activityTypeName(activity)}|${distance}|${duration}`,
        activityId: activity.activityId || null, date, time, type: activityTypeName(activity), name: activity.name || activityTypeName(activity),
        source: fileName, activityUnitsVersion: 2, distance, calories: jsonNumber(activity.calories) === null ? null : jsonNumber(activity.calories) / 4.184, duration,
        avgHr: jsonNumber(activity.avgHr), maxHr: jsonNumber(activity.maxHr), aerobicTe: jsonNumber(activity.aerobicTrainingEffect),
        pace: speedMps > 0 ? 1000 / speedMps : (distance > 0 ? duration / distance : null),
        ascent: jsonNumber(activity.elevationGain) === null ? null : jsonNumber(activity.elevationGain) / 100, descent: jsonNumber(activity.elevationLoss) === null ? null : jsonNumber(activity.elevationLoss) / 100, steps: jsonNumber(activity.steps),
        moving: jsonNumber(activity.movingDuration) === null ? null : jsonNumber(activity.movingDuration) / 1000, elapsed: jsonNumber(activity.elapsedDuration) === null ? null : jsonNumber(activity.elapsedDuration) / 1000, cadence: jsonNumber(activity.avgRunCadence),
        strideLength: jsonNumber(activity.avgStrideLength), vo2Max: jsonNumber(activity.vO2MaxValue), trainingLoad: jsonNumber(activity.activityTrainingLoad),
        temperature: jsonNumber(activity.maxTemperature ?? activity.maxTemp), lapCount: jsonNumber(activity.lapCount),
      }];
    });
  }
  function parseGarminSleepJson(data, fileName) {
    if (!Array.isArray(data)) return [];
    return data.flatMap((row) => {
      const date = jsonDate(row.calendarDate), scores = row.sleepScores || {};
      if (!date) return [];
      const deepSleep = jsonNumber(row.deepSleepSeconds), lightSleep = jsonNumber(row.lightSleepSeconds), remSleep = jsonNumber(row.remSleepSeconds);
      const duration = [deepSleep, lightSleep, remSleep].reduce((sum, value) => sum + (value || 0), 0);
      return [{ type: 'daily', date, source: fileName, hasSleepData: true, sleepUnitsVersion: 2, sleepScore: jsonNumber(scores.overallScore), sleepQuality: scores.feedback || null,
        sleepDuration: duration ? duration / 60 : null, deepSleep: deepSleep === null ? null : deepSleep / 60,
        lightSleep: lightSleep === null ? null : lightSleep / 60, remSleep: remSleep === null ? null : remSleep / 60,
        awakeDuration: jsonNumber(row.awakeSleepSeconds) === null ? null : row.awakeSleepSeconds / 60,
        restlessMoments: jsonNumber(row.restlessMomentCount), stress: jsonNumber(row.avgSleepStress), breathingAvg: jsonNumber(row.averageRespiration),
      }];
    });
  }
  function parseGarminWellnessJson(data, fileName) {
    if (!Array.isArray(data)) return [];
    return data.flatMap((row) => {
      const date = jsonDate(row.calendarDate);
      if (!date) return [];
      const stress = row.allDayStress?.aggregatorList || [], asleep = stress.find((entry) => entry.type === 'ASLEEP'), awake = stress.find((entry) => entry.type === 'AWAKE');
      const charge = jsonNumber(row.bodyBattery?.chargedValue), drained = jsonNumber(row.bodyBattery?.drainedValue);
      return [{ type: 'daily', date, source: fileName, steps: jsonNumber(row.totalSteps), totalCalories: jsonNumber(row.totalKilocalories),
        activeCalories: jsonNumber(row.activeKilocalories), distanceMeters: jsonNumber(row.totalDistanceMeters), activeSeconds: jsonNumber(row.activeSeconds),
        floorsAscended: jsonNumber(row.floorsAscendedInMeters), restingHr: jsonNumber(row.restingHeartRate ?? row.currentDayRestingHeartRate),
        stress: jsonNumber(asleep?.averageStressLevel ?? awake?.averageStressLevel), bodyBatteryChange: charge === null && drained === null ? null : (charge || 0) - (drained || 0),
        bodyBatteryCharged: charge, bodyBatteryDrained: drained, spo2Avg: jsonNumber(row.averageSpo2Value), spo2Min: jsonNumber(row.lowestSpo2Value), spo2Source: row.averageSpo2Value == null ? null : 'denní',
        breathingAvg: jsonNumber(row.respiration?.avgWakingRespirationValue),
      }];
    });
  }
  function parseGarminJson(text, fileName, sourceName = fileName) {
    const data = JSON.parse(text.replace(/^\uFEFF/, ''));
    const name = fileName.split(/[\\/]/).pop().toLowerCase();
    if (name.includes('summarizedactivities')) return { kind: 'activity', records: parseGarminActivityJson(data, sourceName) };
    if (name.endsWith('sleepdata.json')) return { kind: 'daily', records: parseGarminSleepJson(data, sourceName) };
    if (name.startsWith('udsfile_')) return { kind: 'daily', records: parseGarminWellnessJson(data, sourceName) };
    if (name.startsWith('metricsheataltitudeacclimation_')) return { kind: 'daily', records: Array.isArray(data) ? data.flatMap((row) => { const date = jsonDate(row.calendarDate); return date ? [{ type: 'daily', date, source: sourceName, heatAcclimation: jsonNumber(row.heatAcclimationPercentage), altitudeAcclimation: jsonNumber(row.altitudeAcclimation) }] : []; }) : [] };
    if (name.startsWith('metricsacutetrainingload_')) return { kind: 'daily', records: Array.isArray(data) ? data.flatMap((row) => { const date = jsonDate(row.calendarDate); return date ? [{ type: 'daily', date, source: sourceName, trainingLoad: jsonNumber(row.dailyTrainingLoadAcute), chronicTrainingLoad: jsonNumber(row.dailyTrainingLoadChronic) }] : []; }) : [] };
    if (name.startsWith('traininghistory_')) return { kind: 'daily', records: Array.isArray(data) ? data.flatMap((row) => { const date = jsonDate(row.calendarDate); return date ? [{ type: 'daily', date, source: sourceName, trainingStatus: row.trainingStatus || null }] : []; }) : [] };
    if (name.startsWith('metricsmaxmetdata_')) return { kind: 'daily', records: Array.isArray(data) ? data.flatMap((row) => { const date = jsonDate(row.calendarDate); return date ? [{ type: 'daily', date, source: sourceName, vo2Max: jsonNumber(row.vO2MaxValue) }] : []; }) : [] };
    if (name.startsWith('hydrationlogfile_')) return { kind: 'hydration', records: Array.isArray(data) ? data.flatMap((row) => { const date = jsonDate(row.calendarDate); return date ? [{ type: 'daily', date, source: sourceName, hydrationEntries: [{ id: row.uuid?.uuid || `${row.persistedTimestampGMT}|${row.valueInML}`, value: jsonNumber(row.valueInML) || 0 }] }] : []; }) : [] };
    if (name.includes('fitnessagedata')) return { kind: 'daily', records: (Array.isArray(data) ? data : [data]).flatMap((row) => { const date = jsonDate(row.asOfDateGmt); return date ? [{ type: 'daily', date, source: sourceName, fitnessAge: jsonNumber(row.currentBioAge) }] : []; }) };
    return { kind: 'unknown', records: [] };
  }
  function isGarminCsvCandidate(fileName) {
    const name = normalize(fileName.split(/[\\/]/).pop());
    return name.includes('activities.csv') || name.includes('rezim spanku') || name.includes('skore spanku') || name.includes('sleep score') || name.includes('sleepdata');
  }
  function isGarminJsonCandidate(fileName) {
    const name = fileName.split(/[\\/]/).pop().toLowerCase();
    return name.includes('summarizedactivities') || name.endsWith('sleepdata.json') || name.startsWith('udsfile_') || name.startsWith('traininghistory_') || name.startsWith('metricsacutetrainingload_') || name.startsWith('metricsheataltitudeacclimation_') || name.startsWith('metricsmaxmetdata_') || name.startsWith('hydrationlogfile_') || name.includes('fitnessagedata');
  }
  function mergeDailyRecord(existing, incoming) {
    const merged = { ...existing };
    for (const [key, value] of Object.entries(incoming)) {
      if (value !== null && value !== undefined && value !== '') merged[key] = value;
    }
    if (existing.hydrationEntries || incoming.hydrationEntries) {
      const entries = new Map();
      for (const entry of [...(existing.hydrationEntries || []), ...(incoming.hydrationEntries || [])]) entries.set(entry.id, entry);
      merged.hydrationEntries = [...entries.values()];
      merged.hydrationMl = merged.hydrationEntries.reduce((sum, entry) => sum + (entry.value || 0), 0);
    }
    return merged;
  }
  function upsertDailyRecord(record) {
    const index = sleepRecords.findIndex((existing) => existing.date === record.date && existing.type === record.type && (record.type !== 'weekly' || existing.periodLabel === record.periodLabel));
    if (index < 0) { sleepRecords.push(record); return 'added'; }
    sleepRecords[index] = mergeDailyRecord(sleepRecords[index], record);
    return 'merged';
  }
  function upsertActivityRecord(record) {
    const duplicate = activityRecords.find((existing) => {
      if (existing.activityId && record.activityId) return String(existing.activityId) === String(record.activityId);
      if (existing.id && record.id && existing.id === record.id) return true;
      if (existing.date !== record.date) return false;
      const existingName = normalize(existing.name || existing.type), incomingName = normalize(record.name || record.type);
      const sameName = existingName && incomingName && existingName === incomingName;
      const sameType = normalize(existing.type) === normalize(record.type);
      const sameDistance = Number.isFinite(existing.distance) && Number.isFinite(record.distance) && Math.abs(existing.distance - record.distance) <= Math.max(0.05, Math.max(existing.distance, record.distance) * 0.01);
      const sameDuration = Number.isFinite(existing.duration) && Number.isFinite(record.duration) && Math.abs(existing.duration - record.duration) <= Math.max(15, Math.max(existing.duration, record.duration) * 0.01);
      return (sameName || sameType) && sameDistance && sameDuration;
    });
    if (!duplicate) { activityRecords.push(record); return 'added'; }
    for (const [key, value] of Object.entries(record)) if ((duplicate[key] === null || duplicate[key] === undefined || duplicate[key] === '') && value !== null && value !== undefined && value !== '') duplicate[key] = value;
    if (!duplicate.activityId && record.activityId) duplicate.activityId = record.activityId;
    return 'merged';
  }
  function normalizeStoredActivities() {
    let changed = false;
    for (const record of activityRecords) {
      const legacyGarminJson = String(record.source || '').toLowerCase().includes('garmin json');
      if (legacyGarminJson && record.activityUnitsVersion !== 2) {
        // Repair records created by the earlier parser, which treated Garmin's
        // scaled export fields as metres/seconds and left duplicates from CSV.
        if (Number.isFinite(record.distance)) record.distance /= 100;
        if (Number.isFinite(record.duration)) record.duration /= 1000;
        if (Number.isFinite(record.pace)) record.pace /= 10;
        if (Number.isFinite(record.calories)) record.calories /= 4.184;
        if (Number.isFinite(record.ascent)) record.ascent /= 100;
        if (Number.isFinite(record.descent)) record.descent /= 100;
        if (Number.isFinite(record.moving)) record.moving /= 1000;
        if (Number.isFinite(record.elapsed)) record.elapsed /= 1000;
        record.activityUnitsVersion = 2;
        changed = true;
      }
    }
    const records = activityRecords;
    activityRecords = [];
    for (const record of records) {
      const before = activityRecords.length;
      upsertActivityRecord(record);
      if (activityRecords.length === before) changed = true;
    }
    return changed;
  }
  function normalizeStoredSleepDurations() {
    let changed = false;
    const durationKeys = ['sleepDuration', 'deepSleep', 'lightSleep', 'remSleep', 'awakeDuration'];
    for (const record of sleepRecords) {
      if (record.type === 'weekly' || !durationKeys.some((key) => Number.isFinite(Number(record[key])))) continue;
      if (record.sleepUnitsVersion !== 2) {
        for (const key of durationKeys) {
          const value = Number(record[key]);
          if (Number.isFinite(value) && value > 24 * 60) record[key] = value / 60;
        }
        record.sleepUnitsVersion = 2;
        changed = true;
      }
    }
    return changed;
  }
  function getRange() {
    const choice = $('#range-select').value;
    const today = new Date();
    let from, to = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (choice === 'today') {
      from = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    } else if (choice === 'yesterday') {
      from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
      to = new Date(from.getFullYear(), from.getMonth(), from.getDate());
      to.setHours(23, 59, 59, 999);
    } else if (choice === 'month') {
      from = new Date(today.getFullYear(), today.getMonth(), 1);
    } else if (choice === 'previous-month') {
      from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      to = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999);
    } else if (choice === 'custom') {
      from = $('#range-from').value ? new Date(`${$('#range-from').value}T00:00:00`) : new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29);
      to = $('#range-to').value ? new Date(`${$('#range-to').value}T23:59:59`) : new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
    } else if (choice === 'all') {
      const dates = [...sleepRecords, ...activityRecords, ...weightRecords.map((r) => ({ date: r.measuredAt?.slice(0, 10) }))].map((r) => new Date(`${r.date}T00:00:00`)).filter((d) => !Number.isNaN(d.getTime()));
      from = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29);
      to.setHours(23, 59, 59, 999);
    } else {
      const days = Number(choice) || 30;
      from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - days + 1);
    }
    from.setHours(0, 0, 0, 0);
    const start = localDateString(from);
    const end = localDateString(to);
    return { from, to, start, end };
  }
  function saveSelectedRange() {
    try {
      localStorage.setItem('mojezdravi.range.v1', JSON.stringify({
        choice: $('#range-select').value,
        from: $('#range-from').value,
        to: $('#range-to').value,
      }));
    } catch (error) {
      console.warn('Vybrané období se nepodařilo uložit.', error);
    }
  }
  function restoreSelectedRange() {
    try {
      const saved = JSON.parse(localStorage.getItem('mojezdravi.range.v1') || 'null');
      if (!saved || ![...$('#range-select').options].some((option) => option.value === saved.choice)) return false;
      $('#range-select').value = saved.choice;
      if (saved.from) $('#range-from').value = saved.from;
      if (saved.to) $('#range-to').value = saved.to;
      $('#custom-range').classList.toggle('hidden', saved.choice !== 'custom');
      return true;
    } catch {
      return false;
    }
  }
  function inRange(record, range) { return record.date >= range.start && record.date <= range.end; }
  function currentRangeRecords() { const range = getRange(); return { range, records: sleepRecords.filter((r) => inRange(r, range)) }; }
  function allDataDates() {
    return [...sleepRecords.map((r) => r.date), ...activityRecords.map((r) => r.date), ...weightRecords.map((r) => r.measuredAt?.slice(0, 10))].filter(Boolean).sort();
  }
  function timelineEntries() {
    const page = document.body.dataset.page || 'overview';
    if (page === 'sleep') return sleepRecords.filter(isSleepRecord).map((r) => ({ date: r.date, kind: 'sleep' }));
    if (page === 'activity') return activityRecords.map((r) => ({ date: r.date, kind: 'activity' }));
    if (page === 'weight') return weightRecords.map((r) => ({ date: r.measuredAt?.slice(0, 10), kind: 'weight' })).filter((r) => r.date);
    return [
      ...sleepRecords.map((r) => ({ date: r.date, kind: isSleepRecord(r) ? 'sleep' : 'daily' })),
      ...activityRecords.map((r) => ({ date: r.date, kind: 'activity' })),
      ...weightRecords.map((r) => ({ date: r.measuredAt?.slice(0, 10), kind: 'weight' })),
    ].filter((r) => r.date);
  }
  function updateTimeline(range = getRange()) {
    const entries = timelineEntries();
    const dates = entries.map((entry) => entry.date).sort();
    const plot = $('#timeline-plot');
    const legend = $('#timeline-legend');
    const legendItem = (kind, label) => `<span class="timeline-legend-item"><i class="tick-${kind}"></i>${label}</span>`;
    legend.innerHTML = document.body.dataset.page === 'sleep' ? legendItem('sleep', 'Sp&#225;nek') : document.body.dataset.page === 'activity' ? legendItem('activity', 'Aktivity') : document.body.dataset.page === 'weight' ? legendItem('weight', 'T&#283;lesn&#233; hodnoty') : [legendItem('sleep', 'Sp&#225;nek'), legendItem('daily', 'Denn&#237; data'), legendItem('activity', 'Aktivity'), legendItem('weight', 'T&#283;lesn&#233; hodnoty')].join('');
    if (!dates.length) {
      plot.classList.add('timeline-disabled');
      $('#timeline-label').textContent = 'Načti data pro zobrazení osy';
      $('#timeline-min').textContent = '—'; $('#timeline-max').textContent = '—';
      $('#timeline-ticks').innerHTML = ''; $('#timeline-date-labels').innerHTML = '';
      return;
    }
    plot.classList.remove('timeline-disabled');
    const minDate = dates[0], maxDate = dates.at(-1);
    const day = (iso) => Math.round((new Date(`${iso}T00:00:00`) - new Date(`${minDate}T00:00:00`)) / 86400000);
    const maxDay = Math.max(1, day(maxDate));
    const startDay = Math.max(0, Math.min(maxDay, day(range.start)));
    const endDay = Math.max(startDay, Math.min(maxDay, day(range.end)));
    const start = $('#timeline-start'), end = $('#timeline-end');
    for (const slider of [start, end]) { slider.min = '0'; slider.max = String(maxDay); }
    start.value = String(startDay); end.value = String(endDay);
    const left = startDay / maxDay * 100, right = endDay / maxDay * 100;
    $('#timeline-selected').style.left = `${left}%`;
    $('#timeline-selected').style.width = `${Math.max(1, right - left)}%`;
    $('#timeline-min').textContent = fmtDate(minDate);
    $('#timeline-max').textContent = fmtDate(maxDate);
    $('#timeline-label').textContent = `${fmtDate(range.start)} – ${fmtDate(range.end)}`;
    const labelCount = Math.min(7, Math.max(2, Math.ceil(maxDay / 90) + 1));
    $('#timeline-date-labels').innerHTML = Array.from({ length: labelCount }, (_, i) => { const offset = Math.round(maxDay * i / (labelCount - 1)); const date = new Date(`${minDate}T12:00:00`); date.setDate(date.getDate() + offset); return `<span style="left:${offset / maxDay * 100}%">${esc(fmtDate(localDateString(date), { month: 'short', year: 'numeric' }))}</span>`; }).join('');
    const uniqueEntries = [...new Map(entries.map((entry) => [`${entry.date}|${entry.kind}`, entry])).values()];
    $('#timeline-ticks').innerHTML = uniqueEntries.map(({ date, kind }) => `<i class="tick-${kind}" style="left:${day(date) / maxDay * 100}%" title="${kind === 'sleep' ? 'Spánek' : kind === 'activity' ? 'Aktivita' : kind === 'weight' ? 'Tělesné měření' : 'Denní Garmin data'} · ${esc(fmtDate(date))}"></i>`).join('');
  }
  function applyTimelineValues(changedId) {
    const dates = timelineEntries().map((entry) => entry.date).sort();
    if (!dates.length) return;
    const minDate = dates[0], maxDay = Math.max(1, Math.round((new Date(`${dates.at(-1)}T00:00:00`) - new Date(`${minDate}T00:00:00`)) / 86400000));
    const start = $('#timeline-start'), end = $('#timeline-end');
    if (Number(start.value) > Number(end.value)) {
      if (changedId === 'timeline-start') end.value = start.value;
      else start.value = end.value;
    }
    const dateFor = (offset) => { const date = new Date(`${minDate}T00:00:00`); date.setDate(date.getDate() + Math.min(maxDay, Number(offset))); return localDateString(date); };
    $('#range-select').value = 'custom'; $('#custom-range').classList.remove('hidden');
    $('#range-from').value = dateFor(start.value); $('#range-to').value = dateFor(end.value);
    saveSelectedRange();
    updateDashboard();
  }
  function average(records, key) {
    const vals = records.map((r) => r[key]).filter((v) => v !== '' && v !== null && v !== undefined).map(Number).filter(Number.isFinite);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  function chartCards(host, definitions, render, hasData, emptyText = 'Pro tyto ukazatele nejsou ve zvoleném období data.') {
    const cards = definitions.filter((item) => hasData(item.key));
    host.className = cards.length ? 'metric-trend-grid' : 'chart-empty';
    host.innerHTML = cards.length
      ? cards.map((item) => `<article class="panel metric-trend-card"><div class="metric-trend-heading"><strong>${esc(item.label)}</strong><span>${esc(item.note || '')}</span></div>${render(item.key)}</article>`).join('')
      : `<strong>${esc(emptyText)}</strong>`;
  }
  function metricDefinitions(keys, info) { return keys.map((key) => ({ key, label: info[key]?.label || key, note: info[key]?.unit || '' })); }
  function mountOverviewHealthCharts() {
    if ($('#overview-health-charts')) return;
    const section = document.createElement('section');
    section.id = 'overview-health-charts';
    section.className = 'overview-health-charts';
    section.innerHTML = '<div class="section-heading"><div><h2>Denní ukazatele</h2><p>Průběh všech dostupných hodnot ve zvoleném období</p></div></div><div id="overview-health-grid"></div>';
    $('#page-overview .battery-section').after(section);
  }
  function mountInsightForecastCharts() {
    if ($('#insight-forecast-charts')) return;
    const section = document.createElement('section');
    section.id = 'insight-forecast-charts';
    section.className = 'insight-forecast-charts';
    section.innerHTML = '<div class="section-heading"><div><h2>Možný vývoj na dalších 30 dní</h2><p>Čárkovaná část prodlužuje nedávný trend; jde o orientační scénář, ne jistou předpověď.</p></div><span class="explore-tag">SCÉNÁŘ</span></div><div id="insight-forecast-grid" class="insight-forecast-grid"></div>';
    $('.insight-charts-section').after(section);
  }
  function mountGarminQuickOverview() {
    if ($('#garmin-quick-overview')) return;
    const section = document.createElement('section');
    section.id = 'garmin-quick-overview';
    section.className = 'garmin-quick-overview';
    section.innerHTML = '<div class="section-heading"><div><h2>Stručný přehled</h2><p>Nejdůležitější hodnoty a jejich vývoj ve zvoleném období</p></div><span id="quick-overview-count" class="quick-overview-count"></span></div><div id="garmin-quick-grid" class="garmin-quick-grid"></div>';
    const timeline = $('#page-overview .timeline-panel');
    timeline.after(section);
  }
  function quickSparkline(values, color) {
    const nums = values.map(Number).filter(Number.isFinite);
    if (!nums.length) return '<div class="quick-empty-visual">Čeká na data</div>';
    if (nums.length === 1) return `<div class="quick-sparkline"><svg viewBox="0 0 240 64" role="img"><line x1="8" y1="54" x2="232" y2="54" stroke="#e8edf4"/><circle cx="120" cy="30" r="5" fill="white" stroke="${color}" stroke-width="3"/></svg></div>`;
    let lo = Math.min(...nums), hi = Math.max(...nums);
    if (lo === hi) { lo -= 1; hi += 1; }
    const pts = nums.map((n, i) => `${8 + i * 224 / (nums.length - 1)},${54 - (n - lo) / (hi - lo) * 42}`).join(' ');
    return `<div class="quick-sparkline"><svg viewBox="0 0 240 64" preserveAspectRatio="none" role="img"><line x1="8" y1="54" x2="232" y2="54" stroke="#e8edf4"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="232" cy="${54 - (nums.at(-1) - lo) / (hi - lo) * 42}" r="4" fill="white" stroke="${color}" stroke-width="2.5"/></svg></div>`;
  }
  function quickRing(value, max, color, label) {
    if (!Number.isFinite(value)) return '<div class="quick-ring-wrap"><span class="quick-ring-empty">—</span></div>';
    const progress = Math.max(0, Math.min(1, value / max)), circumference = 2 * Math.PI * 34;
    return `<div class="quick-ring-wrap"><svg viewBox="0 0 88 88" role="img" aria-label="${esc(label)}"><circle cx="44" cy="44" r="34" fill="none" stroke="#e9edf3" stroke-width="8"/><circle cx="44" cy="44" r="34" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${(circumference * progress).toFixed(1)} ${circumference.toFixed(1)}" transform="rotate(-90 44 44)"/></svg><strong>${esc(label)}</strong></div>`;
  }
  function renderGarminQuickOverview(records, activities) {
    const daily = records.filter((r) => r.type !== 'weekly').sort((a, b) => a.date.localeCompare(b.date));
    const getPoints = (key, source = daily) => source.map((r) => ({ date: r.date, value: Number(r[key]) })).filter((p) => Number.isFinite(p.value));
    const latest = (key, source = daily) => getPoints(key, source).at(-1) || null;
    const valueText = (point, format) => point ? format(point.value) : '—';
    const avg7 = (key) => average(daily.slice(-7), key);
    const cards = [
      { key: 'hr', title: 'Klidový tep', icon: '♥', tone: '#f05a64', value: valueText(latest('restingHr'), (v) => `${Math.round(v)} <small>t/min.</small>`), note: avg7('restingHr') === null ? 'Klidový průměr · 7 dní' : `Průměr 7 dní · ${Math.round(avg7('restingHr'))} t/min.`, visual: quickSparkline(getPoints('restingHr').slice(-14).map((p) => p.value), '#f05a64') },
      { key: 'steps', title: 'Kroky', icon: '↟', tone: '#3489ed', value: valueText(latest('steps'), (v) => Math.round(v).toLocaleString('cs-CZ')), note: latest('steps') ? `Cíl 7 500 · ${Math.round(latest('steps').value / 7500 * 100)} %` : 'Denní cíl · 7 500 kroků', visual: quickRing(latest('steps')?.value ?? NaN, 7500, '#3489ed', latest('steps') ? `${Math.min(100, Math.round(latest('steps').value / 7500 * 100))} %` : '—') },
      { key: 'calories', title: 'Spálené kalorie', icon: '♨', tone: '#22a36d', value: valueText(latest('totalCalories'), (v) => Math.round(v).toLocaleString('cs-CZ')), note: latest('activeCalories') ? `${Math.round(latest('activeCalories').value).toLocaleString('cs-CZ')} aktivní kcal` : 'Celkem za den', visual: quickSparkline(getPoints('totalCalories').slice(-14).map((p) => p.value), '#22a36d') },
      { key: 'stress', title: 'Stres', icon: '◌', tone: '#ed8b42', value: valueText(latest('stress'), (v) => `${Math.round(v)} <small>bodů</small>`), note: 'Průměrná hodnota Garmin', visual: quickRing(latest('stress')?.value ?? NaN, 100, '#ed8b42', latest('stress') ? `${Math.round(latest('stress').value)}` : '—') },
      { key: 'battery', title: 'Body Battery', icon: '↗', tone: '#2477d4', value: '—', note: 'Průběžná úroveň 0–100', visual: quickRing(NaN, 100, '#2477d4', '—') },
      { key: 'vo2', title: 'VO₂ max', icon: '⌁', tone: '#8e61da', value: '—', note: 'Poslední dostupné měření', visual: '' },
      { key: 'sleep', title: 'Skóre spánku', icon: '☾', tone: '#a84ec1', value: valueText(latest('sleepScore'), (v) => `${Math.round(v)} <small>/ 100</small>`), note: latest('sleepDuration') ? `Délka ${fmtDuration(latest('sleepDuration').value)}` : 'Skóre poslední noci', visual: quickSparkline(getPoints('sleepScore').slice(-14).map((p) => p.value), '#a84ec1') },
      { key: 'breathing', title: 'Dýchání', icon: '≈', tone: '#19a9bd', value: valueText(latest('breathingAvg'), (v) => `${v.toFixed(1)} <small>brpm</small>`), note: 'Průměrná hodnota', visual: quickSparkline(getPoints('breathingAvg').slice(-14).map((p) => p.value), '#19a9bd') },
    ];
    const batteryPoints = daily.flatMap((r) => (Array.isArray(r.bodyBatteryLevels) ? r.bodyBatteryLevels : []).map((point) => ({ ...point, date: r.date }))).map((p) => ({ time: Number(p.time) || Date.parse(p.time), value: Number(p.value) })).filter((p) => Number.isFinite(p.value) && Number.isFinite(p.time)).sort((a, b) => a.time - b.time);
    const batteryLatest = batteryPoints.at(-1)?.value;
    const batteryCard = cards.find((c) => c.key === 'battery');
    batteryCard.value = Number.isFinite(batteryLatest) ? `${Math.round(batteryLatest)} <small>/ 100</small>` : '—';
    batteryCard.note = Number.isFinite(batteryLatest) ? 'Poslední zaznamenaná úroveň' : 'Průběžná úroveň 0–100';
    batteryCard.visual = quickRing(batteryLatest ?? NaN, 100, '#2477d4', Number.isFinite(batteryLatest) ? `${Math.round(batteryLatest)}` : '—');
    const vo2Points = [...getPoints('vo2Max'), ...activities.map((r) => ({ date: r.date, value: Number(r.vo2Max) })).filter((p) => Number.isFinite(p.value))].sort((a, b) => a.date.localeCompare(b.date));
    const vo2Latest = vo2Points.at(-1);
    const vo2Card = cards.find((c) => c.key === 'vo2');
    vo2Card.value = valueText(vo2Latest, (v) => `${v.toFixed(1)} <small>ml/kg/min</small>`);
    vo2Card.note = vo2Latest ? `Záznam · ${fmtDate(vo2Latest.date)}` : 'Poslední dostupné měření';
    vo2Card.visual = quickSparkline(vo2Points.slice(-14).map((p) => p.value), '#8e61da');
    $('#quick-overview-count').textContent = `${daily.length} denních záznamů`;
    $('#garmin-quick-grid').innerHTML = cards.map((card) => `<article class="quick-card" style="--quick-tone:${card.tone}"><div class="quick-card-head"><span class="quick-icon">${card.icon}</span><strong>${card.title}</strong></div><div class="quick-value">${card.value}</div><div class="quick-note">${card.note}</div>${card.visual}</article>`).join('');
  }
  function renderBattery(records) {
    const rows = records.filter((r) => r.bodyBatteryCharged != null || r.bodyBatteryDrained != null)
      .sort((a, b) => a.date.localeCompare(b.date));
    const levelPoints = records.flatMap((r) => (Array.isArray(r.bodyBatteryLevels) ? r.bodyBatteryLevels : []).map((point) => ({ ...point, date: r.date })));
    $('#battery-note').textContent = levelPoints.length
      ? 'Synchronizace Garminu obsahuje i průběžnou úroveň 0–100. Křivka ukazuje zaznamenané hodnoty; nejde o zdravotní hodnocení.'
      : 'Export obsahuje denní nabití a výdej, ne průběžnou úroveň Body Battery 0–100. Graf proto ukazuje denní součty, ne aktuální stav ani zdravotní hodnocení.';
    renderBatteryLevels(levelPoints);
    const charged = rows.reduce((sum, r) => sum + (Number(r.bodyBatteryCharged) || 0), 0);
    const drained = rows.reduce((sum, r) => sum + (Number(r.bodyBatteryDrained) || 0), 0);
    const net = average(rows, 'bodyBatteryChange');
    $('#battery-net').textContent = net === null ? '—' : `${net > 0 ? '+' : ''}${Math.round(net)} bodů/den`;
    $('#battery-net-note').textContent = rows.length ? `Průměr z ${rows.length} denních záznamů` : 'Průměr za období';
    $('#battery-charged').textContent = rows.length ? `+${Math.round(charged)} bodů` : '—';
    $('#battery-drained').textContent = rows.length ? `−${Math.round(drained)} bodů` : '—';
    $('#battery-chart-subtitle').textContent = `${rows.length} dní s údaji o Body Battery`;
    const host = $('#battery-trend-chart');
    if (!rows.length) { host.className = 'chart-empty'; host.innerHTML = '<strong>Body Battery zatím v datech není</strong><span>Naimportuj Garmin denní wellness souhrny.</span>'; return; }
    host.className = 'battery-svg-wrap';
    const W = 900, H = 250, left = 42, right = 14, top = 18, base = 125, bottom = 32;
    const plotted = rows.length > 60 ? Array.from({ length: 60 }, (_, i) => rows[Math.round(i * (rows.length - 1) / 59)]) : rows;
    const max = Math.max(10, ...plotted.flatMap((r) => [Number(r.bodyBatteryCharged) || 0, Number(r.bodyBatteryDrained) || 0])) * 1.12;
    const slot = (W - left - right) / plotted.length, barW = Math.max(1.5, Math.min(9, slot * .32));
    const yCharge = (v) => base - (v / max) * (base - top);
    const yDrain = (v) => base + (v / max) * (H - base - bottom);
    const grid = [0, .5, 1].map((p) => { const up = base - p * (base - top), down = base + p * (H - base - bottom); return `<line x1="${left}" y1="${up}" x2="${W-right}" y2="${up}" stroke="#edf0f5" stroke-dasharray="3 5"/><line x1="${left}" y1="${down}" x2="${W-right}" y2="${down}" stroke="#edf0f5" stroke-dasharray="3 5"/>${p ? `<text x="${left-8}" y="${up+3}" fill="#99a3b2" font-size="10" text-anchor="end">${Math.round(max*p)}</text><text x="${left-8}" y="${down+3}" fill="#99a3b2" font-size="10" text-anchor="end">${Math.round(max*p)}</text>` : ''}`; }).join('');
    const bars = plotted.map((r, i) => { const center = left + slot * (i + .5), charge = Number(r.bodyBatteryCharged) || 0, drain = Number(r.bodyBatteryDrained) || 0; return `<g><title>${esc(fmtDate(r.date))}: nabito +${Math.round(charge)}, vybito −${Math.round(drain)}</title><rect x="${center-barW-1}" y="${yCharge(charge)}" width="${barW}" height="${Math.max(1,base-yCharge(charge))}" rx="${Math.min(3,barW/2)}" fill="#37b988"/><rect x="${center+1}" y="${base}" width="${barW}" height="${Math.max(1,yDrain(drain)-base)}" rx="${Math.min(3,barW/2)}" fill="#ed9b66"/></g>`; }).join('');
    const labelIndexes = [0, Math.floor((plotted.length - 1) / 2), plotted.length - 1].filter((v, i, a) => a.indexOf(v) === i);
    const labels = labelIndexes.map((i) => `<text x="${left + slot * (i + .5)}" y="${H-7}" fill="#8e99aa" font-size="10" text-anchor="middle">${esc(fmtDate(plotted[i].date,{day:'numeric',month:'short'}))}</text>`).join('');
    host.innerHTML = `<svg class="battery-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Denní nabití Body Battery nad nulovou osou a vybití pod ní">${grid}<line x1="${left}" y1="${base}" x2="${W-right}" y2="${base}" stroke="#cfd7e3" stroke-width="1.5"/>${bars}${labels}</svg>`;
  }
  function renderBatteryLevels(points) {
    const host = $('#battery-level-chart');
    $('#battery-current').textContent = '—';
    $('#battery-current-note').textContent = 'Průběžná úroveň 0–100';
    if (!points.length) {
      $('#battery-level-subtitle').textContent = 'Zobrazí se po synchronizaci, pokud Garmin vrátí průběžné hodnoty';
      host.className = 'chart-empty';
      host.innerHTML = '<strong>Průběžná úroveň zatím není v datech</strong><span>Samotný export obvykle obsahuje jen denní nabití a výdej.</span>';
      return;
    }
    const parsed = points.map((point) => {
      let time = typeof point.time === 'number' ? point.time : (/^\d+$/.test(String(point.time)) ? Number(point.time) : Date.parse(point.time));
      if (time > 0 && time < 1e12) time *= 1000;
      return { time, value: Number(point.value), date: point.date };
    }).filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value) && point.value >= 0 && point.value <= 100).sort((a, b) => a.time - b.time);
    if (!parsed.length) { host.className = 'chart-empty'; host.innerHTML = '<strong>Průběžné hodnoty nemají rozpoznatelný čas</strong>'; return; }
    const latest = parsed.at(-1);
    $('#battery-current').textContent = `${Math.round(latest.value)} / 100`;
    $('#battery-current-note').textContent = `Poslední záznam · ${new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(latest.time))}`;
    const plotted = parsed.length > 360 ? Array.from({ length: 360 }, (_, i) => parsed[Math.round(i * (parsed.length - 1) / 359)]) : parsed;
    const W = 900, H = 190, left = 42, right = 14, top = 14, bottom = 30;
    const min = plotted[0].time, max = plotted.at(-1).time, span = Math.max(1, max - min);
    const x = (time) => left + (time - min) / span * (W - left - right);
    const y = (value) => top + (100 - value) / 100 * (H - top - bottom);
    const segments = []; let segment = [];
    for (const point of plotted) {
      if (segment.length && point.time - segment.at(-1).time > 6 * 60 * 60 * 1000) { segments.push(segment); segment = []; }
      segment.push(point);
    }
    if (segment.length) segments.push(segment);
    const fills = segments.filter((items) => items.length > 1).map((items) => {
      const line = items.map((point, i) => `${i ? 'L' : 'M'}${x(point.time).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ');
      return `<path d="${line} L${x(items.at(-1).time).toFixed(1)},${y(0)} L${x(items[0].time).toFixed(1)},${y(0)} Z" fill="#37b988" opacity=".09"/>`;
    }).join('');
    const paths = segments.map((items) => items.slice(1).map((point, i) => {
      const prior = items[i], color = point.value >= prior.value ? '#27b783' : '#e99a61';
      return `<path d="M${x(prior.time).toFixed(1)},${y(prior.value).toFixed(1)} L${x(point.time).toFixed(1)},${y(point.value).toFixed(1)}" fill="none" stroke="${color}" stroke-width="2.8" stroke-linecap="round"/>`;
    }).join('')).join('');
    const labels = [0, .25, .5, .75, 1].map((part) => {
      const value = Math.round(100 * (1 - part)), yy = y(value);
      return `<line x1="${left}" y1="${yy}" x2="${W-right}" y2="${yy}" stroke="#edf0f5" stroke-dasharray="3 5"/><text x="${left-9}" y="${yy+3}" fill="#99a3b2" font-size="10" text-anchor="end">${value}</text>`;
    }).join('');
    const endLabels = [plotted[0], plotted[Math.floor((plotted.length-1)/2)], plotted.at(-1)].filter((point, i, all) => all.findIndex((p) => p.time === point.time) === i).map((point) => {
      const label = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(point.time));
      return `<text x="${x(point.time)}" y="${H-7}" fill="#8e99aa" font-size="10" text-anchor="middle">${esc(label)}</text>`;
    }).join('');
    const dots = plotted.filter((_, i) => i % Math.max(1, Math.ceil(plotted.length / 80)) === 0 || i === plotted.length - 1).map((point) => `<circle cx="${x(point.time)}" cy="${y(point.value)}" r="2.4" fill="#fff" stroke="#37b988" stroke-width="1.5"><title>${esc(new Date(point.time).toLocaleString('cs-CZ'))}: ${Math.round(point.value)}</title></circle>`).join('');
    $('#battery-level-subtitle').textContent = `${plotted.length.toLocaleString('cs-CZ')} hodnot · osa 0–100`;
    host.className = 'battery-svg-wrap battery-level-wrap';
    host.innerHTML = `<svg class="battery-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Průběžná úroveň Body Battery od nuly do sta">${labels}${fills}${paths}${dots}${endLabels}</svg>`;
  }
  function fmtDate(iso, options = { day: 'numeric', month: 'short', year: 'numeric' }) {
    if (!iso) return '—';
    return new Intl.DateTimeFormat('cs-CZ', options).format(new Date(`${iso}T12:00:00`));
  }
  function fmtDuration(minutes) { if (minutes === null || !Number.isFinite(minutes)) return '—'; return `${Math.floor(minutes / 60)} h ${String(Math.round(minutes % 60)).padStart(2, '0')} min`; }
  function setMetric(id, value, unit, decimals = 0) {
    $(`#${id}`).innerHTML = value === null ? `— <small>${unit}</small>` : `${decimals ? value.toFixed(decimals).replace('.', ',') : Math.round(value).toLocaleString('cs-CZ')} <small>${unit}</small>`;
  }
  function setNote(id, text) { $(`#${id}`).textContent = text; }
  function singlePointChart(date, value, label, color = '#6484f0') {
    return `<svg class="trend-svg single-point-svg" viewBox="0 0 700 150" role="img" aria-label="${esc(label)} · ${esc(fmtDate(date))}: ${esc(value)}"><line class="grid" x1="28" y1="32" x2="690" y2="32"/><line class="grid" x1="28" y1="76" x2="690" y2="76"/><line class="grid" x1="28" y1="120" x2="690" y2="120"/><line x1="350" y1="26" x2="350" y2="124" stroke="${color}" stroke-opacity=".18" stroke-dasharray="3 4"/><circle cx="350" cy="76" r="6" fill="#fff" stroke="${color}" stroke-width="3"><title>${esc(fmtDate(date))}: ${esc(value)}</title></circle><text x="350" y="143" fill="#8490a3" font-size="11" text-anchor="middle">${esc(fmtDate(date))} · ${esc(value)}</text></svg>`;
  }
  function chartValueLabels(points, x, y, format) {
    const indexes = points.length <= 8 ? points.map((_, i) => i) : [...new Set([0, Math.round((points.length - 1) / 2), points.length - 1])];
    return indexes.map((i) => `<text class="point-value" x="${x(i)}" y="${Math.max(15, y(points[i].value) - 10)}" text-anchor="middle">${esc(format(points[i]))}</text>`).join('');
  }
  function downsampleTrendPoints(points, maxPoints = 90) {
    if (points.length <= maxPoints) return points;
    const bucketCount = Math.max(2, Math.floor(maxPoints / 2)), sampled = [];
    for (let bucket = 0; bucket < bucketCount; bucket++) {
      const start = Math.floor(bucket * points.length / bucketCount);
      const end = Math.max(start + 1, Math.floor((bucket + 1) * points.length / bucketCount));
      const group = points.slice(start, end);
      const min = group.reduce((best, point) => point.value < best.value ? point : best, group[0]);
      const max = group.reduce((best, point) => point.value > best.value ? point : best, group[0]);
      sampled.push(...(min === max ? [min] : [min, max]).sort((a, b) => points.indexOf(a) - points.indexOf(b)));
    }
    return [...new Set(sampled)];
  }
  function buildTrend(records, key) {
    const rawPoints = records.map((r) => ({ date: r.date, value: r[key] == null || r[key] === '' ? NaN : Number(r[key]) })).filter((p) => Number.isFinite(p.value)).sort((a, b) => a.date.localeCompare(b.date));
    const points = downsampleTrendPoints(rawPoints);
    if (!points.length) return `<div class="chart-empty"><span class="chart-icon"><svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 6-7"/></svg></span><strong>Pro tento ukazatel zatím nejsou data</strong><span>Importuj další Garmin CSV nebo zvol jiné období.</span></div>`;
    if (points.length === 1) return singlePointChart(points[0].date, metricInfo[key].format(points[0].value), metricInfo[key].label);
    const width = 700, height = 230, pad = { l: 32, r: 10, t: 11, b: 24 };
    const vals = points.map((p) => p.value); let low = Math.min(...vals), high = Math.max(...vals);
    if (low === high) { low -= 1; high += 1; }
    const extra = (high - low) * .18; low -= extra; high += extra;
    const x = (i) => pad.l + i * (width - pad.l - pad.r) / (points.length - 1);
    const y = (v) => pad.t + (high - v) * (height - pad.t - pad.b) / (high - low);
    const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    const area = `${path} L${x(points.length - 1)},${height - pad.b} L${x(0)},${height - pad.b} Z`;
    const dateLabels = [points[0], points[Math.floor((points.length - 1) / 2)], points[points.length - 1]];
    const dateX = [x(0), x(Math.floor((points.length - 1) / 2)), x(points.length - 1)];
    const valueLabels = chartValueLabels(points, x, y, (point) => metricInfo[key].format(point.value));
    return `<svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(metricInfo[key].label)} v čase"><defs><linearGradient id="areaFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#6484f0" stop-opacity=".2"/><stop offset="100%" stop-color="#6484f0" stop-opacity="0"/></linearGradient></defs><line class="grid" x1="${pad.l}" y1="${pad.t + 12}" x2="${width - pad.r}" y2="${pad.t + 12}"/><line class="grid" x1="${pad.l}" y1="${(height + pad.t - pad.b) / 2}" x2="${width - pad.r}" y2="${(height + pad.t - pad.b) / 2}"/><line class="grid" x1="${pad.l}" y1="${height - pad.b}" x2="${width - pad.r}" y2="${height - pad.b}"/><path class="area" d="${area}"/><path class="line" d="${path}"/>${points.map((p, i) => `<circle class="point" cx="${x(i)}" cy="${y(p.value)}" r="3"><title>${esc(fmtDate(p.date))}: ${esc(metricInfo[key].format(p.value))}</title></circle>`).join('')}${valueLabels}${dateLabels.map((p, i) => `<text x="${dateX[i]}" y="${height - 5}" text-anchor="${i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}">${esc(fmtDate(p.date, { day: 'numeric', month: 'short' }))}</text>`).join('')}</svg>`;
  }
  function updateComposition(records, targetId = 'sleep-composition-content') {
    const target = $(`#${targetId}`);
    const deep = average(records, 'deepSleep'), light = average(records, 'lightSleep'), rem = average(records, 'remSleep'), awake = average(records, 'awakeDuration');
    if ([deep, light, rem].every((v) => v === null)) {
      target.innerHTML = '<div class="composition-empty"><div class="donut-placeholder"><span>—</span></div><div class="composition-legend"><span><i class="deep"></i>Hluboký<small>—</small></span><span><i class="light"></i>Lehký<small>—</small></span><span><i class="rem"></i>REM<small>—</small></span><span><i class="awake"></i>Bdělost<small>—</small></span></div></div>';
      return;
    }
    const list = [deep || 0, light || 0, rem || 0, awake || 0], total = list.reduce((a, b) => a + b, 0) || 1;
    const colors = ['#5478ed', '#89a3f5', '#ca89e5', '#e7a35a'];
    let cursor = 0;
    const gradient = list.map((v, i) => { const start = cursor; cursor += v / total * 100; return `${colors[i]} ${start.toFixed(1)}% ${cursor.toFixed(1)}%`; }).join(',');
    target.innerHTML = `<div class="composition-empty"><div class="donut-placeholder" style="background:conic-gradient(${gradient})"><span>${fmtDuration(average(records, 'sleepDuration'))}</span></div><div class="composition-legend"><span><i class="deep"></i>Hluboký<small>${deep ? fmtDuration(deep) : '—'}</small></span><span><i class="light"></i>Lehký<small>${light ? fmtDuration(light) : '—'}</small></span><span><i class="rem"></i>REM<small>${rem ? fmtDuration(rem) : '—'}</small></span><span><i class="awake"></i>Bdělost<small>${awake ? fmtDuration(awake) : '—'}</small></span></div></div>`;
  }
  function mountSharedPeriodControls() {
    const overview = $('#page-overview');
    const range = overview.querySelector('.range-bar'), timeline = overview.querySelector('.timeline-panel');
    const heading = overview.querySelector('.page-heading');
    heading.after(range);
    range.after(timeline);
    $('#page-sleep .range-bar')?.remove();
    document.body.dataset.page = 'overview';
  }
  function mountSleepDashboard() {
    const page = $('#page-sleep'), block = document.createElement('section');
    block.id = 'sleep-page-dashboard';
    block.innerHTML = `<div class="section-heading"><div><h2>Statistiky spánku</h2><p>Souhrn podle vybraného období</p></div><span class="section-tag"><i></i><span id="sleep-page-count">0 nocí</span></span></div><div class="metrics-grid sleep-page-metrics"><article class="metric-card accent-purple"><span class="metric-label">Průměrné skóre</span><div class="metric-value" id="sleep-page-score">—</div><div class="metric-note">z 100 bodů</div></article><article class="metric-card accent-orange"><span class="metric-label">Délka spánku</span><div class="metric-value" id="sleep-page-duration">—</div><div class="metric-note">průměr za noc</div></article><article class="metric-card accent-blue"><span class="metric-label">Hluboký spánek</span><div class="metric-value" id="sleep-page-deep">—</div><div class="metric-note">průměr za noc</div></article><article class="metric-card accent-cyan"><span class="metric-label">REM spánek</span><div class="metric-value" id="sleep-page-rem">—</div><div class="metric-note">průměr za noc</div></article><article class="metric-card accent-green"><span class="metric-label">Průměrné SpO₂</span><div class="metric-value" id="sleep-page-spo2">—</div><div class="metric-note">v Garmin denních datech nebo během spánku</div></article></div><div class="activity-charts sleep-page-charts"><article class="panel"><div class="panel-heading"><div><h2>Vývoj spánku a zdraví</h2><p id="sleep-chart-subtitle">Vyber ukazatel</p></div><select id="sleep-chart-metric" aria-label="Metrika spánku"><option value="sleepScore">Skóre spánku</option><option value="sleepDuration">Délka spánku</option><option value="restingHr">Klidový tep</option><option value="stress">Stres</option><option value="spo2Avg">SpO₂</option><option value="steps">Kroky</option><option value="bodyBatteryChange">Body Battery</option><option value="breathingAvg">Dýchání</option><option value="totalCalories">Celkem kalorií</option><option value="hydrationMl">Vypitá voda</option><option value="trainingLoad">Tréninková zátěž</option><option value="vo2Max">VO₂ max</option><option value="fitnessAge">Fitness věk</option><option value="activeCalories">Aktivní kalorie</option><option value="chronicTrainingLoad">Dlouhodobá zátěž</option><option value="heatAcclimation">Aklimatizace na teplo</option><option value="altitudeAcclimation">Aklimatizace na výšku</option><option value="activeSeconds">Aktivní čas</option><option value="floorsAscended">Převýšení dne</option></select></div><div id="sleep-page-trend" class="chart-empty"></div></article><article class="panel"><div class="panel-heading"><div><h2>Fáze spánku</h2><p>Průměrná délka za noc</p></div></div><div id="sleep-page-composition" class="composition-content"></div></article></div>`;
    const insertBefore = page.querySelector('.section-heading');
    page.insertBefore(block, insertBefore);
  }
  function mountActivityStats() {
    const grid = $('#page-activity .activity-grid');
    $('.metric-label', grid).textContent = 'Průměrná délka běhu';
    $('.metric-note', grid).textContent = 'Průměrná vzdálenost na aktivitu';
    grid.insertAdjacentHTML('beforeend', '<article class="metric-card accent-purple"><span class="metric-label">Průměrné tempo</span><div class="metric-value" id="activity-avg-pace">—</div><div class="metric-note">min/km</div></article><article class="metric-card accent-pink"><span class="metric-label">Průměrný tep</span><div class="metric-value" id="activity-avg-hr">—</div><div class="metric-note">t/min.</div></article>');
  }
  function mountWeightForm() {
    const form = $('#weight-form');
    const labels = { fatFreeWeight: 'Hmotnost bez tuku', visceralFat: 'Vnitřní tuk', bodyWater: 'Voda v těle (%)', skeletalMuscle: 'Kosterní svaly (%)', muscleMass: 'Svalová hmota' };
    for (const [name, labelText] of Object.entries(labels)) {
      const input = $(`[name="${name}"]`, form);
      if (input?.parentElement?.firstChild) input.parentElement.firstChild.textContent = `${labelText} `;
    }
    const noteLabel = $('[name="note"]', form).closest('label');
    const metrics = [
      ['protein', 'Protein (%)', '0.1', '18,6'], ['bmr', 'BMR (kcal)', '1', '1916'],
      ['boneMass', 'Kostní hmota', '0.01', '3,58'], ['metabolicAge', 'Metabolický věk', '1', '27'],
    ];
    for (const [name, labelText, step, placeholder] of metrics) {
      const label = document.createElement('label'); label.className = 'field'; label.append(document.createTextNode(labelText));
      const input = document.createElement('input'); input.name = name; input.type = 'number'; input.step = step; input.min = '0'; input.placeholder = `např. ${placeholder}`;
      label.append(input); noteLabel.before(label);
    }
  }
  function mountWeightDashboard() {
    const page = $('#page-weight'), block = document.createElement('section');
    block.id = 'weight-dashboard';
    block.innerHTML = `<div class="section-heading"><div><h2>Statistiky těla</h2><p>Souhrn naměřených hodnot ve zvoleném období</p></div><span class="section-tag"><i></i><span id="weight-period-count">0 měření</span></span></div><div class="metrics-grid weight-summary-grid"><article class="metric-card accent-blue"><span class="metric-label">Poslední hmotnost</span><div class="metric-value" id="weight-latest">—</div><div class="metric-note" id="weight-latest-date">Zadej první měření</div></article><article class="metric-card accent-purple"><span class="metric-label">BMI</span><div class="metric-value" id="weight-bmi-average">—</div><div class="metric-note">průměr v období</div></article><article class="metric-card accent-pink"><span class="metric-label">Tělesný tuk</span><div class="metric-value" id="weight-fat-average">—</div><div class="metric-note">průměr v období</div></article><article class="metric-card accent-green"><span class="metric-label">Změna hmotnosti</span><div class="metric-value" id="weight-change">—</div><div class="metric-note">oproti předchozímu měření</div></article></div><div class="panel weight-chart-panel"><div class="panel-heading"><div><h2>Vývoj tělesných hodnot</h2><p id="weight-chart-subtitle">Vyber metriku pro graf</p></div><select id="weight-chart-metric" aria-label="Metrika tělesných hodnot"><option value="weight">Hmotnost</option><option value="bmi">BMI</option><option value="bodyFat">Tělesný tuk</option><option value="skeletalMuscle">Kosterní svaly</option><option value="muscleMass">Svalová hmota</option><option value="protein">Protein</option><option value="bmr">BMR</option><option value="fatFreeWeight">Hmotnost bez tuku</option><option value="subcutaneousFat">Podkožní tuk</option><option value="visceralFat">Vnitřní tuk</option><option value="bodyWater">Voda v těle</option><option value="boneMass">Kostní hmota</option><option value="metabolicAge">Metabolický věk</option></select></div><div id="weight-trend-chart" class="chart-empty"><strong>Graf se zobrazí po zadání měření</strong></div></div><div class="weight-body-grid"><article class="panel"><div class="panel-heading"><div><h2>Poslední složení těla</h2><p>Podle nejnovějšího měření</p></div></div><div id="weight-latest-composition" class="weight-composition-grid"></div></article><aside class="panel weight-info-panel"><strong>Porovnání v čase</strong><p>Hmotnost z lb se při kreslení grafu převádí na kg, aby měření ve dvou jednotkách šla porovnat. Ostatní hodnoty zůstávají v jednotkách Feelfit.</p></aside></div>`;
    const layout = page.querySelector('.weight-layout');
    page.insertBefore(block, layout);
  }
  function renderRecent(records) {
    const list = records.filter((r) => r.type === 'weekly' || r.sleepScore != null || r.sleepDuration != null).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
    const host = $('#recent-table');
    if (!list.length) {
      host.className = 'table-empty';
      host.innerHTML = '<div class="empty-dot"><svg viewBox="0 0 24 24"><path d="M12 3c1.7 3.4 5.5 5.1 5.5 10A5.5 5.5 0 1 1 6.5 13c0-2.4 1.2-4.4 3-6.4-.1 2 1 3.1 2.1 3.8C12 8.2 12.4 5.7 12 3Z"/></svg></div><strong>Zatím tu nejsou žádná měření</strong><span>Načti celý Garmin export nebo denní CSV a přehled se naplní.</span><button class="button button-soft" data-goto="import">Otevřít import</button>';
      return;
    }
    host.className = '';
    host.innerHTML = `<table class="recent-table"><thead><tr><th>DATUM</th><th>TYP</th><th>SKÓRE</th><th>DÉLKA SPÁNKU</th><th>KVALITA</th><th>NOČNÍ TEP</th></tr></thead><tbody>${list.map((r) => `<tr><td>${esc(fmtDate(r.date))}</td><td>${r.type === 'weekly' ? 'Týdenní souhrn' : 'Denní report'}</td><td>${r.sleepScore ?? '—'}</td><td>${r.sleepDuration ? esc(fmtDuration(r.sleepDuration)) : '—'}</td><td>${esc(r.sleepQuality || '—')}</td><td>${r.restingHr ? `${Math.round(r.restingHr)} t/min.` : '—'}</td></tr>`).join('')}</tbody></table>`;
  }
  function fmtActivityDuration(seconds) {
    if (!Number.isFinite(seconds)) return '—';
    const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = Math.floor(seconds % 60);
    return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min ${String(s).padStart(2, '0')} s`;
  }
  function fmtPace(seconds) {
    if (!Number.isFinite(seconds)) return '—';
    return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')} /km`;
  }
  const activityInfo = {
    distance: { label: 'Vzdálenost', format: (r) => `${r.distance.toFixed(2)} km`, value: (r) => r.distance },
    duration: { label: 'Doba aktivity', format: (r) => fmtActivityDuration(r.duration), value: (r) => r.duration == null ? NaN : r.duration / 60 },
    avgHr: { label: 'Průměrný tep', format: (r) => `${Math.round(r.avgHr)} t/min.`, value: (r) => r.avgHr },
    calories: { label: 'Kalorie', format: (r) => `${Math.round(r.calories).toLocaleString('cs-CZ')} kcal`, value: (r) => r.calories },
    pace: { label: 'Průměrné tempo', format: (r) => fmtPace(r.pace), value: (r) => r.pace },
    ascent: { label: 'Převýšení', format: (r) => `${Math.round(r.ascent)} m`, value: (r) => r.ascent },
    steps: { label: 'Kroky při aktivitě', format: (r) => Math.round(r.steps).toLocaleString('cs-CZ'), value: (r) => r.steps },
    trainingLoad: { label: 'Tréninková zátěž', format: (r) => `${r.trainingLoad.toFixed(1)}`, value: (r) => r.trainingLoad },
    vo2Max: { label: 'VO₂ max', format: (r) => `${r.vo2Max.toFixed(1)} ml/kg/min`, value: (r) => r.vo2Max },
    cadence: { label: 'Kadence', format: (r) => `${Math.round(r.cadence)} kroků/min`, value: (r) => r.cadence },
    strideLength: { label: 'Délka kroku', format: (r) => `${Math.round(r.strideLength)} mm`, value: (r) => r.strideLength },
    aerobicTe: { label: 'Aerobní tréninkový efekt', format: (r) => r.aerobicTe.toFixed(1), value: (r) => r.aerobicTe },
  };
  function buildActivityTrend(records, key) {
    const info = activityInfo[key];
    const rawPoints = records.map((record) => ({ record, value: info.value(record) })).filter((p) => Number.isFinite(p.value)).sort((a, b) => a.record.date.localeCompare(b.record.date));
    const points = downsampleTrendPoints(rawPoints);
    if (!points.length) return '<div class="chart-empty"><strong>Pro tento ukazatel nejsou v období data</strong><span>Zkus jiný ukazatel nebo období.</span></div>';
    if (points.length === 1) return singlePointChart(points[0].record.date, info.format(points[0].record), info.label, '#35b889');
    const width = 700, height = 230, pad = { l: 30, r: 10, t: 12, b: 24 }, vals = points.map((p) => p.value);
    let low = Math.min(...vals), high = Math.max(...vals); if (low === high) { low -= 1; high += 1; }
    const extra = (high - low) * .16; low -= extra; high += extra;
    const x = (i) => pad.l + i * (width - pad.l - pad.r) / (points.length - 1);
    const y = (v) => pad.t + (high - v) * (height - pad.t - pad.b) / (high - low);
    const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    const dates = [points[0], points[Math.floor((points.length - 1) / 2)], points.at(-1)];
    const xs = [x(0), x(Math.floor((points.length - 1) / 2)), x(points.length - 1)];
    const valueLabels = chartValueLabels(points, x, y, (point) => info.format(point.record));
    return `<svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(info.label)} v čase"><line class="grid" x1="${pad.l}" y1="${pad.t}" x2="${width - pad.r}" y2="${pad.t}"/><line class="grid" x1="${pad.l}" y1="${(height - pad.b + pad.t) / 2}" x2="${width - pad.r}" y2="${(height - pad.b + pad.t) / 2}"/><line class="grid" x1="${pad.l}" y1="${height - pad.b}" x2="${width - pad.r}" y2="${height - pad.b}"/><path class="line" d="${path}"/>${points.map((p, i) => `<circle class="point" cx="${x(i)}" cy="${y(p.value)}" r="3"><title>${esc(fmtDate(p.record.date))} · ${esc(info.format(p.record))}</title></circle>`).join('')}${valueLabels}${dates.map((p, i) => `<text x="${xs[i]}" y="${height - 5}" text-anchor="${i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}">${esc(fmtDate(p.record.date, { day: 'numeric', month: 'short' }))}</text>`).join('')}</svg>`;
  }
  function renderActivityCharts(records) {
    const activityKeys = ['distance', 'duration', 'avgHr', 'pace', 'calories', 'ascent', 'steps', 'trainingLoad', 'vo2Max', 'cadence', 'strideLength', 'aerobicTe'];
    $('#activity-chart-subtitle').textContent = `${records.length} aktivit · všechny dostupné ukazatele`;
    chartCards($('#activity-trend-chart'), metricDefinitions(activityKeys, activityInfo), (key) => buildActivityTrend(records, key), (key) => records.some((r) => r[key] != null && r[key] !== '' && Number.isFinite(Number(r[key]))), 'Pro zvolené období nejsou žádné aktivity.');
    const months = new Map();
    for (const record of records) {
      const key = record.date.slice(0, 7);
      months.set(key, (months.get(key) || 0) + (record.distance || 0));
    }
    const entries = [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-8);
    const host = $('#activity-volume-chart');
    if (!entries.length) { host.className = 'bar-chart-empty'; host.textContent = 'Importuj soubor s aktivitami pro zobrazení souhrnu.'; }
    else {
      host.className = 'monthly-bars';
      const max = Math.max(...entries.map(([, value]) => value), 1);
      host.innerHTML = entries.map(([month, value]) => `<div class="month-bar"><span class="bar-value">${value.toFixed(1)} km</span><i style="height:${Math.max(4, value / max * 100)}%" title="${esc(value.toFixed(2))} km"></i><small>${esc(new Intl.DateTimeFormat('cs-CZ', { month: 'short' }).format(new Date(`${month}-15T12:00:00`)))}</small></div>`).join('');
    }
  }
  function rank(values) {
    const ordered = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
    const result = Array(values.length);
    for (let i = 0; i < ordered.length;) {
      let j = i + 1; while (j < ordered.length && ordered[j].value === ordered[i].value) j++;
      const avgRank = (i + 1 + j) / 2;
      for (let k = i; k < j; k++) result[ordered[k].index] = avgRank;
      i = j;
    }
    return result;
  }
  function correlation(x, y) {
    const a = rank(x), b = rank(y), meanA = average(a, 'value') ?? a.reduce((s, v) => s + v, 0) / a.length, meanB = b.reduce((s, v) => s + v, 0) / b.length;
    let numerator = 0, sumA = 0, sumB = 0;
    for (let i = 0; i < a.length; i++) { const da = a[i] - meanA, db = b[i] - meanB; numerator += da * db; sumA += da * da; sumB += db * db; }
    return sumA && sumB ? numerator / Math.sqrt(sumA * sumB) : 0;
  }
  function renderHypothesis(range = getRange()) {
    const bySleepDate = new Map(sleepRecords.filter((r) => r.type === 'daily' && inRange(r, range) && Number.isFinite(r.sleepScore)).map((r) => [r.date, r.sleepScore]));
    const distanceByDate = new Map();
    for (const record of activityRecords.filter((r) => inRange(r, range))) distanceByDate.set(record.date, (distanceByDate.get(record.date) || 0) + (record.distance || 0));
    const pairs = [...bySleepDate.entries()].map(([date, sleepScore]) => ({ date, distance: distanceByDate.get(date) || 0, sleepScore }));
    const host = $('#hypothesis-content');
    if (pairs.length < 8) {
      host.className = 'hypothesis-empty';
      host.innerHTML = `<span class="hypothesis-icon">⌁</span><div><strong>Na hledání souvislostí je potřeba alespoň 8 spárovaných dnů</strong><span>Zatím ${pairs.length} ${pairs.length === 1 ? 'den' : 'dnů'} se skóre spánku i záznamem aktivity. Souvislost sama o sobě neprokazuje příčinu.</span></div>`;
      return;
    }
    const rho = correlation(pairs.map((p) => p.distance), pairs.map((p) => p.sleepScore));
    const interpretation = Math.abs(rho) < .25 ? 'V tomto vzorku zatím není vidět výrazná souvislost mezi vzdáleností aktivity a skóre spánku.' : rho > 0 ? 'Dny s delší zaznamenanou aktivitou mají v tomto vzorku tendenci souviset s vyšším skóre spánku.' : 'Dny s delší zaznamenanou aktivitou mají v tomto vzorku tendenci souviset s nižším skóre spánku.';
    host.className = 'hypothesis-result';
    host.innerHTML = `<span class="hypothesis-icon">↗</span><div><strong>${esc(interpretation)}</strong><span>Spearmanova korelace ρ = ${rho.toFixed(2)} · ${pairs.length} spárovaných dnů · stejný kalendářní den. Jde o průzkumný vztah, nikoli důkaz příčiny nebo zdravotní doporučení.</span></div>`;
  }
  function buildProjectionCard(records, key) {
    const info = metricInfo[key];
    const points = records.map((record) => ({ date: record.date, value: Number(record[key]) }))
      .filter((point) => point.date && Number.isFinite(point.value)).sort((a, b) => a.date.localeCompare(b.date));
    const title = info.label;
    if (points.length < 10) return `<article class="panel projection-card"><div class="panel-heading"><div><h3>${esc(title)}</h3><p>Výhled zatím nelze spočítat</p></div></div><div class="projection-empty">Je potřeba alespoň 10 záznamů této metriky.</div></article>`;

    const latest = points.at(-1), latestTime = new Date(`${latest.date}T12:00:00`).getTime();
    const dayNumber = (date) => Math.round((new Date(`${date}T12:00:00`).getTime() - latestTime) / 86400000);
    const recent = points.filter((point) => dayNumber(point.date) >= -60);
    const buckets = new Map();
    for (const point of recent) {
      const day = dayNumber(point.date), bucket = Math.floor((day + 60) / 7);
      const values = buckets.get(bucket) || [];
      values.push({ day, value: point.value }); buckets.set(bucket, values);
    }
    const weekly = [...buckets.values()].map((values) => ({
      day: values.reduce((sum, point) => sum + point.day, 0) / values.length,
      value: values.reduce((sum, point) => sum + point.value, 0) / values.length,
    })).sort((a, b) => a.day - b.day);
    const span = weekly.length ? weekly.at(-1).day - weekly[0].day : 0;
    if (weekly.length < 4 || span < 21) return `<article class="panel projection-card"><div class="panel-heading"><div><h3>${esc(title)}</h3><p>Málo dat pro smysluplný trend</p></div></div><div class="projection-empty">Přidej záznamy rozložené alespoň do čtyř týdnů.</div></article>`;

    const meanX = weekly.reduce((sum, point) => sum + point.day, 0) / weekly.length;
    const meanY = weekly.reduce((sum, point) => sum + point.value, 0) / weekly.length;
    const denominator = weekly.reduce((sum, point) => sum + (point.day - meanX) ** 2, 0);
    const slope = weekly.reduce((sum, point) => sum + (point.day - meanX) * (point.value - meanY), 0) / (denominator || 1);
    const rawForecast = meanY + slope * (30 - meanX);
    const limits = { sleepScore: [0, 100], sleepDuration: [0, 24 * 60], restingHr: [25, 220], steps: [0, 100000], stress: [0, 100], spo2Avg: [50, 100] };
    const [minLimit, maxLimit] = limits[key] || [-Infinity, Infinity];
    const forecast = Math.max(minLimit, Math.min(maxLimit, rawForecast));
    const clipped = forecast !== rawForecast;
    const historyStart = latestTime - 90 * 86400000, futureTime = latestTime + 30 * 86400000;
    const shown = downsampleTrendPoints(points.filter((point) => new Date(`${point.date}T12:00:00`).getTime() >= historyStart), 70);
    const values = [...shown.map((point) => point.value), forecast];
    let low = Math.min(...values), high = Math.max(...values);
    if (low === high) { low -= 1; high += 1; }
    const margin = (high - low) * .2; low -= margin; high += margin;
    const W = 700, H = 270, pad = { left: 35, right: 16, top: 26, bottom: 38 };
    const x = (time) => pad.left + (time - historyStart) / (futureTime - historyStart) * (W - pad.left - pad.right);
    const y = (value) => pad.top + (high - value) / (high - low) * (H - pad.top - pad.bottom);
    const historyPath = shown.map((point, i) => `${i ? 'L' : 'M'}${x(new Date(`${point.date}T12:00:00`).getTime()).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ');
    const todayX = x(latestTime), forecastX = x(futureTime), latestY = y(latest.value), forecastY = y(forecast);
    const grid = [0, .5, 1].map((part) => {
      const yy = pad.top + part * (H - pad.top - pad.bottom);
      return `<line x1="${pad.left}" y1="${yy}" x2="${W - pad.right}" y2="${yy}" stroke="#e9edf4" stroke-dasharray="3 5"/>`;
    }).join('');
    const axisLabels = [
      `<text x="${pad.left}" y="${H - 9}" text-anchor="start">${esc(fmtDate(shown[0]?.date || latest.date, { day: 'numeric', month: 'short' }))}</text>`,
      `<text x="${todayX}" y="${H - 9}" text-anchor="middle">Poslední záznam</text>`,
      `<text x="${forecastX}" y="${H - 9}" text-anchor="end">+30 dní</text>`,
    ].join('');
    const latestLabel = esc(info.format(latest.value)), forecastLabel = esc(info.format(forecast));
    const delta = forecast - latest.value;
    const deltaLabel = `${delta > 0 ? '+' : ''}${info.format(delta)}`;
    return `<article class="panel projection-card"><div class="panel-heading"><div><h3>${esc(title)}</h3><p>Trend po týdnech · posledních 60 dní</p></div><span class="projection-delta">${esc(deltaLabel)}</span></div><div class="projection-readings"><div><span>Poslední záznam</span><strong>${latestLabel}</strong></div><div><span>Scénář za 30 dní</span><strong>${forecastLabel}</strong></div></div><svg class="projection-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}: poslední hodnota ${latestLabel}, scénář za 30 dní ${forecastLabel}">${grid}<line x1="${todayX}" y1="${pad.top}" x2="${todayX}" y2="${H - pad.bottom}" stroke="#b8c2d2" stroke-dasharray="4 5"/><path d="${historyPath}" fill="none" stroke="#5279eb" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M${todayX},${latestY} L${forecastX},${forecastY}" fill="none" stroke="#8b6ce8" stroke-width="3.5" stroke-dasharray="8 7" stroke-linecap="round"/><circle cx="${todayX}" cy="${latestY}" r="5" fill="#fff" stroke="#5279eb" stroke-width="3"><title>Poslední hodnota: ${latestLabel}</title></circle><circle cx="${forecastX}" cy="${forecastY}" r="6" fill="#fff" stroke="#8b6ce8" stroke-width="3"><title>Scénář za 30 dní: ${forecastLabel}</title></circle><text class="projection-value-label" x="${Math.max(pad.left + 30, todayX - 10)}" y="${Math.max(pad.top + 18, latestY - 12)}" text-anchor="end">${latestLabel}</text><text class="projection-value-label" x="${forecastX - 6}" y="${Math.max(pad.top + 18, forecastY - 12)}" text-anchor="end">${forecastLabel}</text>${axisLabels}</svg><p class="projection-disclaimer">Extrapolace týdenních průměrů; skutečný průběh se může lišit.${clipped ? ' Hodnota je omezena rozsahem ukazatele.' : ''}</p></article>`;
  }
  function renderInsightForecastCharts(records) {
    const host = $('#insight-forecast-grid');
    if (!host) return;
    const keys = ['sleepScore', 'sleepDuration', 'restingHr', 'steps', 'stress', 'spo2Avg'];
    host.innerHTML = keys.filter((key) => records.some((record) => record[key] !== null && record[key] !== undefined && record[key] !== '' && Number.isFinite(Number(record[key]))))
      .map((key) => buildProjectionCard(records, key)).join('') || '<div class="projection-empty">V datech zatím nejsou ukazatele pro výhled.</div>';
  }
  function renderInsights() {
    const daily = sleepRecords.filter((r) => r.type === 'daily').sort((a,b) => a.date.localeCompare(b.date));
    const nights = daily.filter(isSleepRecord), activities = [...activityRecords].sort((a,b) => a.date.localeCompare(b.date));
    const weights = weightRecords.map((r) => ({...r,date:r.measuredAt?.slice(0,10)||''})).filter((r)=>r.date);
    const dates = [...daily,...activities,...weights].map((r)=>r.date).filter(Boolean).sort();
    const host = $('#insights-grid'), forecast = $('#forecast-grid');
    renderInsightForecastCharts(daily);
    if (!dates.length) { host.innerHTML='<article class="hypothesis-card"><strong>Nejdriv potrebuji data</strong><span>Po importu Garminu a nekolika merenich vahy se zobrazi osobni scenare.</span></article>'; forecast.innerHTML=''; return; }
    const latest=dates.at(-1), shift=(iso,n)=>{const d=new Date(iso+'T12:00:00');d.setDate(d.getDate()+n);return d.toISOString().slice(0,10);};
    const value=(r,k)=>r&&r[k]!==''&&r[k]!=null&&Number.isFinite(Number(r[k]))?Number(r[k]):null;
    const avg=(rows,k)=>{const a=rows.map(r=>value(r,k)).filter(v=>v!==null);return a.length?a.reduce((x,y)=>x+y,0)/a.length:null;};
    const inDays=(rows,from,to)=>rows.filter(r=>r.date>=from&&r.date<=to), fmt=(n,d=1)=>Number(n).toFixed(d).replace('.',',');
    const makeCard=(title,claim,evidence,confidence,tone)=>'<article class="hypothesis-card accent-'+tone+'"><div class="hypothesis-card-head"><span>'+esc(title)+'</span><small>'+esc(confidence)+'</small></div><strong>'+esc(claim)+'</strong><p>Opora v datech: '+esc(evidence)+'</p></article>';
    const runs=activities.filter(r=>{const t=String(r.type||'').toLowerCase();return t.includes('run')||t.includes('b\u011bh');});
    const recentRuns=inDays(runs,shift(latest,-29),latest), priorRuns=inDays(runs,shift(latest,-59),shift(latest,-30));
    const sumKm=rows=>rows.reduce((s,r)=>s+(Number.isFinite(r.distance)?r.distance:0),0), recentKm=sumKm(recentRuns), priorKm=sumKm(priorRuns);
    const vo2Map=new Map();[...daily,...activities].forEach(r=>{const v=value(r,'vo2Max');if(v!==null&&r.date)vo2Map.set(r.date,v);});
    const vo2=[...vo2Map].map(([date,value])=>({date,value})).sort((a,b)=>a.date.localeCompare(b.date));
    const recentVo2=vo2.filter(p=>p.date>=shift(latest,-89)), earlierVo2=vo2.filter(p=>p.date>=shift(latest,-179)&&p.date<shift(latest,-89));
    const vo2Diff=recentVo2.length&&earlierVo2.length?avg(recentVo2,'value')-avg(earlierVo2,'value'):null, lastVo2=vo2.at(-1);
    const recentDaily=inDays(daily,shift(latest,-6),latest), baseDaily=inDays(daily,shift(latest,-34),shift(latest,-7));
    const recentSleep=avg(inDays(nights,shift(latest,-6),latest),'sleepDuration'), baseSleep=avg(inDays(nights,shift(latest,-34),shift(latest,-7)),'sleepDuration');
    const recentHr=avg(recentDaily,'restingHr'), baseHr=avg(baseDaily,'restingHr'), recentLoad=avg(recentDaily,'trainingLoad'), baseLoad=avg(baseDaily,'trainingLoad');
    const weightPts=weights.filter(r=>value(r,'weight')!==null).sort((a,b)=>a.date.localeCompare(b.date));
    const ideas=[];
    ideas.push(recentRuns.length?makeCard('Bezecky objem','Pokud zopakujes posledni mesic, muzes za dalsich 30 dni nabehat asi '+fmt(recentKm,0)+' km.',recentRuns.length+' behu a '+fmt(recentKm,0)+' km poslednich 30 dni; predchozi mesic '+fmt(priorKm,0)+' km.',recentRuns.length>=5?'Vice zaznamu':'Slaba opora','green'):makeCard('Bezecky objem','Dalsi mesic behani zatim nejde odhadnout.','V poslednich 30 dnech neni importovany beh.','Malo dat','green'));
    ideas.push(lastVo2?makeCard('Aerobni kondice',vo2Diff===null?'Pokud se trenink nezmeni, VO2 max muze zustat pobliz posledni namerene hodnoty.':vo2Diff>.5?'Pri podobnem treninku muze aerobni kondice dal pomalu rust.':vo2Diff<-.5?'Pokud pokles pokracuje, muze aerobni kondice kratkodobe klesat.':'Pri podobnem treninku muze aerobni kondice zustat na podobne urovni.','Posledni VO2 max '+fmt(lastVo2.value)+'; '+vo2.length+' hodnot v cele historii.',recentVo2.length>=5?'Vice zaznamu':'Slaba opora','purple'):makeCard('Aerobni kondice','VO2 max v exportu chybi, proto jeho budouci vyvoj neodhaduji.','Garmin nevratil mereni VO2 max.','Bez mereni','purple'));
    ideas.push(weightPts.length>=3?makeCard('Hmotnost','Pri pokracovani namereneho smeru muze hmotnost v pristim mesici klesnout nebo rust.','K dispozici je '+weightPts.length+' mereni; kratky trend muze byt zavadejici.','Omezena opora','pink'):makeCard('Hmotnost','Beh muze podporit pokles hmotnosti, pokud vydej prevysi prijem; tvoje data to zatim nepotvrzuji.','Jen '+weightPts.length+' mereni hmotnosti a '+fmt(recentKm,0)+' km behu za poslednich 30 dni; udaje o jidle chybi.','Velmi slaba opora','pink'));
    const hrDiff=recentHr!==null&&baseHr!==null?recentHr-baseHr:null, sleepDiff=recentSleep!==null&&baseSleep!==null?recentSleep-baseSleep:null, loadDiff=recentLoad!==null&&baseLoad?100*(recentLoad/baseLoad-1):null;
    let recovery='Nedavna data neukazuji jasnou spolecnou zmenu tepu, spanku a zateze.';
    if((hrDiff!==null&&hrDiff>=4&&(sleepDiff===null||sleepDiff<=-20||(loadDiff!==null&&loadDiff>=20)))||(sleepDiff!==null&&sleepDiff<=-35&&loadDiff!==null&&loadDiff>=20))recovery='Vyssi zatez spolu s tepem nebo spankem muze znamenat, ze ted regenerujes hur nez obvykle.';
    else if(hrDiff!==null&&hrDiff<=-3&&sleepDiff!==null&&sleepDiff>=20)recovery='Nizsi klidovy tep a delsi spanek mohou ukazovat na lepsi regeneraci.';
    const ev='Klidovy tep '+(hrDiff===null?'bez srovnani':(hrDiff>0?'+':'')+fmt(hrDiff)+' t/min.')+'; spanek '+(sleepDiff===null?'bez srovnani':(sleepDiff>0?'+':'')+fmt(sleepDiff,0)+' min.')+'; zatez '+(loadDiff===null?'bez srovnani':(loadDiff>0?'+':'')+fmt(loadDiff,0)+' %.');
    ideas.push(makeCard('Regenerace',recovery,ev,recentDaily.length>=5?'Osobni srovnani':'Omezena opora','orange'));
    host.innerHTML=ideas.join('');
    const vo2Projection=recentVo2.length>=5&&((new Date(recentVo2.at(-1).date+'T12:00:00')-new Date(recentVo2[0].date+'T12:00:00'))/86400000)>=21?recentVo2:null;
    const project30=points=>{if(!points||points.length<5)return null;const xs=points.map(p=>new Date(p.date+'T12:00:00').getTime()/86400000),ys=points.map(p=>p.value),span=xs.at(-1)-xs[0];if(span<21)return null;const mx=xs.reduce((a,b)=>a+b,0)/xs.length,my=ys.reduce((a,b)=>a+b,0)/ys.length,slope=xs.reduce((s,x,i)=>s+(x-mx)*(ys[i]-my),0)/(xs.reduce((s,x)=>s+(x-mx)**2,0)||1);return {value:ys.at(-1)+slope*30,count:points.length,span:Math.round(span)};};
    const vp=project30(vo2Projection), wp=project30(weightPts.map(r=>({date:r.date,value:value(r,'weight')})));
    forecast.innerHTML='<article class="insight-card accent-green"><span>Bezecky objem - dalsich 30 dni</span><strong>'+(recentRuns.length?fmt(recentKm,0)+' km':'Bez odhadu')+'</strong><small>'+(recentRuns.length?'Opakuje poslednich 30 dni, bez zohledneni zmeny treninku.':'V poslednich 30 dnech chybi behy.')+'</small></article><article class="insight-card accent-purple"><span>VO2 max - za 30 dni</span><strong>'+(vp?fmt(vp.value)+' ml/kg/min':'Bez projekce')+'</strong><small>'+(vp?'Linearni pokracovani '+vp.count+' mereni z '+vp.span+' dni.':'Potreba alespon 5 mereni rozlozenych do 3 tydnu.')+'</small></article><article class="insight-card accent-pink"><span>Hmotnost - za 30 dni</span><strong>'+(wp?fmt(wp.value)+' kg':'Nelze odhadnout')+'</strong><small>'+(wp?'Kratke pokracovani mereneho trendu.':'Jedno mereni neurci trend; pridej dalsi hodnoty.')+'</small></article>';
    const insightDailyKeys=['sleepScore','sleepDuration','restingHr','steps','stress','spo2Avg','bodyBatteryChange','breathingAvg','trainingLoad','totalCalories'];
    const insightActivityKeys=['distance','duration','avgHr','pace','calories','trainingLoad','vo2Max'];
    const insightWeightKeys=['weight','bmi','bodyFat','skeletalMuscle','muscleMass','bodyWater'];
    $('#insight-daily-subtitle').textContent='Celá historie · '+daily.length+' denních záznamů';
    chartCards($('#insight-daily-chart'),metricDefinitions(insightDailyKeys,metricInfo),(key)=>buildTrend(daily,key),(key)=>daily.some(r=>r[key]!=null&&r[key]!==''&&Number.isFinite(Number(r[key]))),'V historii zatím nejsou denní metriky.');
    $('#insight-activity-subtitle').textContent='Celá historie · '+activities.length+' aktivit';
    chartCards($('#insight-activity-chart'),metricDefinitions(insightActivityKeys,activityInfo),(key)=>buildActivityTrend(activities,key),(key)=>activities.some(r=>r[key]!=null&&r[key]!==''&&Number.isFinite(Number(r[key]))),'V historii zatím nejsou aktivity.');
    $('#insight-weight-subtitle').textContent='Celá historie · '+weights.length+' měření';
    chartCards($('#insight-weight-chart'),metricDefinitions(insightWeightKeys,weightMetricInfo),(key)=>buildWeightTrend(weights,key),(key)=>weights.some(r=>weightMetricInfo[key].get(r)!=null&&weightMetricInfo[key].get(r)!==''&&Number.isFinite(Number(weightMetricInfo[key].get(r)))),'V historii zatím nejsou měření.');
    const sleepMap=new Map(nights.filter(r=>Number.isFinite(r.sleepScore)).map(r=>[r.date,r]));const dailyMap=new Map(daily.map(r=>[r.date,r]));const stepsMap=new Map(daily.filter(r=>Number.isFinite(r.steps)).map(r=>[r.date,r.steps]));const activityMap=new Map();activities.forEach(r=>activityMap.set(r.date,(activityMap.get(r.date)||0)+(Number.isFinite(r.distance)?r.distance:0)));
    const pairs=[...sleepMap].map(([date,r])=>{const d=dailyMap.get(date)||{};return {score:r.sleepScore,duration:r.sleepDuration,steps:stepsMap.get(date),km:activityMap.get(date)||0,battery:d.bodyBatteryChange,restingHr:d.restingHr,trainingLoad:d.trainingLoad};});
    const relations=[['Skóre spánku a kroky','steps','score'],['Skóre spánku a vzdálenost','km','score'],['Délka spánku a kroky','steps','duration'],['Skóre spánku a změna Body Battery','battery','score'],['Klidový tep a změna Body Battery','restingHr','battery'],['Tréninková zátěž a změna Body Battery','trainingLoad','battery']];
    $('#insight-correlation-content').innerHTML='<div class="correlation-grid">'+relations.map(([label,x,y])=>{const sample=pairs.filter(r=>Number.isFinite(r[x])&&Number.isFinite(r[y]));if(sample.length<8)return '<article><strong>'+esc(label)+'</strong><b>Malo sparovanych dat</b><small>'+sample.length+' spolecnych dni; potreba alespon 8.</small></article>';const rho=correlation(sample.map(r=>r[x]),sample.map(r=>r[y]));const msg=Math.abs(rho)<.25?'Bez vyrazne vazby v tomto vzorku.':rho>0?'Hodnoty zde rostou spolecne.':'Hodnoty zde meni smer opacne.';return '<article><strong>'+esc(label)+'</strong><b>rho = '+fmt(rho,2)+'</b><small>'+msg+' '+sample.length+' dni; vztah neprokazuje pricinu.</small></article>';}).join('')+'</div>';
  }
  function renderActivityList(records) {
    const host = $('#activity-list');
    const list = [...records].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`)).slice(0, 15);
    $('#activity-record-count').textContent = `${records.length} ${records.length === 1 ? 'aktivita' : 'aktivit'}`;
    if (!list.length) { host.className = 'table-empty'; host.innerHTML = '<strong>Aktivity zatím nejsou importované</strong><span>Vyber Activities.csv nebo celou Garmin export složku v sekci Import dat.</span>'; return; }
    host.className = 'activity-table-wrap';
    host.innerHTML = `<table class="recent-table activity-table"><thead><tr><th>DATUM</th><th>AKTIVITA</th><th>VZDÁLENOST</th><th>ČAS</th><th>TEMPO</th><th>PRŮMĚRNÝ TEP</th><th>KALORIE</th></tr></thead><tbody>${list.map((r) => `<tr><td>${esc(fmtDate(r.date))}</td><td>${esc(r.type)} · ${esc(r.name)}</td><td>${r.distance.toFixed(2)} km</td><td>${esc(fmtActivityDuration(r.duration))}</td><td>${esc(fmtPace(r.pace))}</td><td>${Number.isFinite(r.avgHr) ? `${Math.round(r.avgHr)} t/min.` : '—'}</td><td>${Number.isFinite(r.calories) ? `${Math.round(r.calories).toLocaleString('cs-CZ')} kcal` : '—'}</td></tr>`).join('')}</tbody></table>`;
  }
  function isSleepRecord(record) {
    return record.type === 'weekly' || record.hasSleepData === true || ['sleepScore', 'sleepDuration', 'deepSleep', 'lightSleep', 'remSleep', 'awakeDuration', 'restlessMoments'].some((key) => record[key] !== null && record[key] !== undefined);
  }
  function renderSleepList(records) {
    const host = $('#sleep-records');
    const list = [...records].sort((a, b) => b.date.localeCompare(a.date));
    $('#sleep-record-count').textContent = `${list.length} ${list.length === 1 ? 'záznam' : list.length >= 2 && list.length <= 4 ? 'záznamy' : 'záznamů'}`;
    if (!list.length) {
      host.className = 'record-list empty-state';
      host.innerHTML = '<span class="empty-icon">☾</span><strong>Historie Garminu se zobrazí po importu</strong><span>Na stránce Import dat vyber celou složku exportu nebo jednotlivé CSV a JSON soubory.</span><button class="button button-primary" data-goto="import">Importovat data</button>';
      return;
    }
    host.className = 'record-list';
    host.innerHTML = list.map((r) => {
      const details = r.type === 'weekly' ? '' : `<details class="record-details"><summary>Všechny hodnoty</summary><div class="record-extra-grid">${[
        ['Lehký spánek', r.lightSleep == null ? '—' : fmtDuration(r.lightSleep)], ['REM spánek', r.remSleep == null ? '—' : fmtDuration(r.remSleep)], ['Bdělost', r.awakeDuration == null ? '—' : fmtDuration(r.awakeDuration)], ['Průměrný stres', r.stress == null ? '—' : `${r.stress} bodů`], ['Klidový tep', r.restingHr == null ? '—' : `${r.restingHr} t/min.`], ['Kroky', r.steps == null ? '—' : Math.round(r.steps).toLocaleString('cs-CZ')], ['Celkem kalorií', r.totalCalories == null ? '—' : `${Math.round(r.totalCalories)} kcal`], ['Aktivní kalorie', r.activeCalories == null ? '—' : `${Math.round(r.activeCalories)} kcal`], ['Změna Body Battery', r.bodyBatteryChange == null ? '—' : `${r.bodyBatteryChange > 0 ? '+' : ''}${r.bodyBatteryChange}`], ['Body Battery nabito/vybito', r.bodyBatteryCharged == null && r.bodyBatteryDrained == null ? '—' : `+${r.bodyBatteryCharged || 0} / −${r.bodyBatteryDrained || 0}`], ['Průměrné SpO₂', r.spo2Avg == null ? '—' : `${r.spo2Avg} %`], ['Nejnižší SpO₂', r.spo2Min == null ? '—' : `${r.spo2Min} %`], ['Průměrné dýchání', r.breathingAvg == null ? '—' : `${r.breathingAvg} brpm`], ['Nejnižší dýchání', r.breathingMin == null ? '—' : `${r.breathingMin} brpm`], ['Hydratace', r.hydrationMl == null ? '—' : `${Math.round(r.hydrationMl)} ml`], ['Akutní tréninková zátěž', r.trainingLoad == null ? '—' : r.trainingLoad], ['Dlouhodobá tréninková zátěž', r.chronicTrainingLoad == null ? '—' : r.chronicTrainingLoad], ['VO₂ max', r.vo2Max == null ? '—' : r.vo2Max], ['Fitness věk', r.fitnessAge == null ? '—' : r.fitnessAge], ['Stav tréninku', r.trainingStatus || '—'], ['Aklimatizace na teplo', r.heatAcclimation == null ? '—' : `${r.heatAcclimation} %`], ['Aklimatizace na výšku', r.altitudeAcclimation == null ? '—' : r.altitudeAcclimation], ['Chvilky neklidu', r.restlessMoments == null ? '—' : r.restlessMoments], ['Zdroj', r.source || 'CSV'],
      ].map(([label, value]) => `<span><small>${esc(label)}</small><strong>${esc(value)}</strong></span>`).join('')}</div></details>`;
      return `<article class="sleep-record"><strong class="record-date">${r.type === 'weekly' ? `Týden ${esc(r.periodLabel || fmtDate(r.date))}` : esc(fmtDate(r.date))}</strong><div class="record-cell"><small>${r.type === 'weekly' ? 'PRŮMĚRNÉ SKÓRE' : 'SKÓRE SPÁNKU'}</small><strong>${r.sleepScore ?? '—'}${r.sleepScore !== undefined ? ' / 100' : ''}</strong></div><div class="record-cell"><small>DÉLKA SPÁNKU</small><strong>${r.sleepDuration ? esc(fmtDuration(r.sleepDuration)) : '—'}</strong></div><div class="record-cell"><small>${r.type === 'weekly' ? 'PRŮMĚRNÁ KVALITA' : 'NOČNÍ STRES'}</small><strong>${r.type === 'weekly' ? esc(r.sleepQuality || '—') : (r.stress ?? '—')}</strong></div><div class="record-cell"><small>${r.type === 'weekly' ? 'PRŮMĚRNÉ ULEHNUTÍ' : 'HLUBOKÝ SPÁNEK'}</small><strong>${r.type === 'weekly' ? '—' : r.deepSleep ? esc(fmtDuration(r.deepSleep)) : '—'}</strong></div><span class="record-quality">${r.type === 'weekly' ? 'Týden' : esc(r.sleepQuality || 'Denní')}</span>${details}</article>`;
    }).join('');
  }
  const weightMetricInfo = {
    weight: { label: 'Hmotnost', unit: 'kg', get: (r) => r.weight == null || r.weight === '' ? null : Number(r.weight) * (r.weightUnit === 'lb' ? 0.45359237 : 1) },
    bmi: { label: 'BMI', unit: '', get: (r) => r.bmi }, bodyFat: { label: 'Tělesný tuk', unit: '%', get: (r) => r.bodyFat },
    skeletalMuscle: { label: 'Kosterní svaly', unit: '%', get: (r) => r.skeletalMuscle },
    muscleMass: { label: 'Svalová hmota', unit: 'kg', get: (r) => r.muscleMass == null || r.muscleMass === '' ? null : Number(r.muscleMass) * (r.weightUnit === 'lb' ? 0.45359237 : 1) },
    protein: { label: 'Protein', unit: '%', get: (r) => r.protein }, bmr: { label: 'BMR', unit: 'kcal', get: (r) => r.bmr },
    fatFreeWeight: { label: 'Hmotnost bez tuku', unit: 'kg', get: (r) => r.fatFreeWeight == null || r.fatFreeWeight === '' ? null : Number(r.fatFreeWeight) * (r.weightUnit === 'lb' ? 0.45359237 : 1) },
    subcutaneousFat: { label: 'Podkožní tuk', unit: '%', get: (r) => r.subcutaneousFat }, visceralFat: { label: 'Vnitřní tuk', unit: '', get: (r) => r.visceralFat },
    bodyWater: { label: 'Voda v těle', unit: '%', get: (r) => r.bodyWater }, boneMass: { label: 'Kostní hmota', unit: 'kg', get: (r) => r.boneMass == null || r.boneMass === '' ? null : Number(r.boneMass) * (r.weightUnit === 'lb' ? 0.45359237 : 1) },
    metabolicAge: { label: 'Metabolický věk', unit: 'let', get: (r) => r.metabolicAge },
  };
  function weightValueText(value, unit, digits = 1) {
    if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—';
    const n = Number(value), shown = Number.isInteger(n) ? String(n) : n.toFixed(digits).replace('.', ',');
    return unit ? `${shown} ${unit}` : shown;
  }
  function buildWeightTrend(records, metric) {
    const info = weightMetricInfo[metric];
    const rawPoints = records.map((r) => ({ date: r.measuredAt.slice(0, 10), raw: info.get(r) })).filter((p) => p.raw !== '' && p.raw !== null && p.raw !== undefined && Number.isFinite(Number(p.raw))).map((p) => ({ date: p.date, value: Number(p.raw) })).sort((a, b) => a.date.localeCompare(b.date));
    const points = downsampleTrendPoints(rawPoints);
    if (!points.length) return '<div class="chart-empty"><strong>Pro tuto hodnotu zatím nejsou měření</strong><span>Zadej hodnotu ve formuláři nebo vyber jinou metriku.</span></div>';
    if (points.length === 1) return singlePointChart(points[0].date, weightValueText(points[0].value, info.unit), info.label, '#8b6ce8');
    const width = 700, height = 230, pad = { l: 26, r: 10, t: 12, b: 25 }, values = points.map((p) => p.value);
    let min = Math.min(...values), max = Math.max(...values); if (min === max) { min -= 1; max += 1; }
    const margin = (max - min) * .15; min -= margin; max += margin;
    const x = (i) => pad.l + i * (width - pad.l - pad.r) / (points.length - 1), y = (v) => pad.t + (max - v) * (height - pad.t - pad.b) / (max - min);
    const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    const labels = [points[0], points[Math.floor((points.length - 1) / 2)], points.at(-1)], xs = [x(0), x(Math.floor((points.length - 1) / 2)), x(points.length - 1)];
    const valueLabels = chartValueLabels(points, x, y, (point) => weightValueText(point.value, info.unit));
    return `<svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Vývoj: ${esc(info.label)}"><line class="grid" x1="${pad.l}" y1="${pad.t}" x2="${width - pad.r}" y2="${pad.t}"/><line class="grid" x1="${pad.l}" y1="${(height - pad.b + pad.t) / 2}" x2="${width - pad.r}" y2="${(height - pad.b + pad.t) / 2}"/><line class="grid" x1="${pad.l}" y1="${height - pad.b}" x2="${width - pad.r}" y2="${height - pad.b}"/><path class="line" d="${path}"/>${points.map((p, i) => `<circle class="point" cx="${x(i)}" cy="${y(p.value)}" r="3"><title>${esc(fmtDate(p.date))}: ${esc(weightValueText(p.value, info.unit))}</title></circle>`).join('')}${valueLabels}${labels.map((p, i) => `<text x="${xs[i]}" y="${height - 5}" text-anchor="${i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}">${esc(fmtDate(p.date, { day: 'numeric', month: 'short' }))}</text>`).join('')}</svg>`;
  }
  function renderWeightDashboard(records) {
    const sorted = [...records].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt)), latest = sorted.at(-1), previousWeights = sorted.filter((r) => Number.isFinite(weightMetricInfo.weight.get(r)));
    $('#weight-period-count').textContent = `${records.length} ${records.length === 1 ? 'měření' : 'měření'}`;
    $('#weight-latest').textContent = latest ? weightValueText(weightMetricInfo.weight.get(latest), 'kg') : '—';
    $('#weight-latest-date').textContent = latest ? fmtDate(latest.measuredAt.slice(0, 10)) : 'Zadej první měření';
    const bmi = average(records, 'bmi'), fat = average(records, 'bodyFat');
    $('#weight-bmi-average').textContent = bmi === null ? '—' : bmi.toFixed(1).replace('.', ',');
    $('#weight-fat-average').textContent = fat === null ? '—' : `${fat.toFixed(1).replace('.', ',')} %`;
    const delta = previousWeights.length > 1 ? weightMetricInfo.weight.get(previousWeights.at(-1)) - weightMetricInfo.weight.get(previousWeights.at(-2)) : null;
    $('#weight-change').textContent = delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(1).replace('.', ',')} kg`;
    const weightKeys = ['weight', 'bmi', 'bodyFat', 'skeletalMuscle', 'muscleMass', 'protein', 'bmr', 'fatFreeWeight', 'subcutaneousFat', 'visceralFat', 'bodyWater', 'boneMass', 'metabolicAge'];
    $('#weight-chart-subtitle').textContent = `${records.length} měření · všechny dostupné hodnoty`;
    chartCards($('#weight-trend-chart'), metricDefinitions(weightKeys, weightMetricInfo), (key) => buildWeightTrend(records, key), (key) => records.some((r) => weightMetricInfo[key].get(r) !== null && weightMetricInfo[key].get(r) !== '' && Number.isFinite(Number(weightMetricInfo[key].get(r)))), 'V tomto období nejsou měření tělesných hodnot.');
    const composition = $('#weight-latest-composition');
    const items = [['bodyFat', 'Tělesný tuk'], ['bmi', 'BMI'], ['skeletalMuscle', 'Kosterní svaly'], ['muscleMass', 'Svalová hmota'], ['protein', 'Protein'], ['bmr', 'BMR'], ['fatFreeWeight', 'Hmotnost bez tuku'], ['subcutaneousFat', 'Podkožní tuk'], ['visceralFat', 'Vnitřní tuk'], ['bodyWater', 'Voda v těle'], ['boneMass', 'Kostní hmota'], ['metabolicAge', 'Metabolický věk']];
    composition.innerHTML = latest ? items.map(([key, label]) => `<div><small>${esc(label)}</small><strong>${esc(weightValueText(weightMetricInfo[key].get(latest), weightMetricInfo[key].unit))}</strong></div>`).join('') : '<div class="weight-chart-empty">Po uložení prvního měření se zde zobrazí celé složení těla.</div>';
  }
  function renderOverviewCharts(records, activities, range) {
    const daily = records.filter((r) => r.type !== 'weekly');
    const weights = weightRecords.filter((r) => inRange({ date: r.measuredAt?.slice(0, 10) || '' }, range));
    const nights = records.filter(isSleepRecord);
    const overviewDaily = metricDefinitions(['sleepScore', 'sleepDuration', 'restingHr', 'steps', 'stress', 'spo2Avg', 'bodyBatteryChange', 'breathingAvg', 'trainingLoad', 'totalCalories'], metricInfo);
    chartCards($('#overview-health-grid'), overviewDaily, (key) => buildTrend(daily, key), (key) => daily.some((r) => r[key] != null && r[key] !== '' && Number.isFinite(Number(r[key]))));

    const activityKeys = ['distance', 'duration', 'avgHr', 'pace', 'calories', 'trainingLoad'];
    const overviewActivity = metricDefinitions(activityKeys, activityInfo);
    $('#overview-activity-subtitle').textContent = `${activities.length} aktivit · dostupné ukazatele`;
    chartCards($('#overview-activity-chart'), overviewActivity, (key) => buildActivityTrend(activities, key), (key) => activities.some((r) => r[key] != null && r[key] !== '' && Number.isFinite(Number(r[key]))));

    const weightKeys = ['weight', 'bmi', 'bodyFat', 'skeletalMuscle', 'muscleMass', 'bodyWater'];
    const overviewWeight = metricDefinitions(weightKeys, weightMetricInfo);
    $('#overview-weight-subtitle').textContent = `${weights.length} měření · dostupné hodnoty`;
    chartCards($('#overview-weight-chart'), overviewWeight, (key) => buildWeightTrend(weights, key), (key) => weights.some((r) => weightMetricInfo[key].get(r) !== null && weightMetricInfo[key].get(r) !== '' && Number.isFinite(Number(weightMetricInfo[key].get(r)))));

    const sleepKeys = ['sleepScore', 'sleepDuration', 'restingHr', 'stress', 'spo2Avg', 'bodyBatteryChange', 'breathingAvg'];
    const overviewSleep = metricDefinitions(sleepKeys, metricInfo);
    $('#overview-sleep-subtitle').textContent = `${nights.length} nocí · dostupné ukazatele`;
    chartCards($('#overview-sleep-chart'), overviewSleep, (key) => buildTrend(nights, key), (key) => nights.some((r) => r[key] != null && r[key] !== '' && Number.isFinite(Number(r[key]))));
  }
  function renderSleepDashboard(records) {
    const daily = records.filter((r) => r.type === 'daily'), source = daily.length ? daily : records.filter((r) => r.type === 'weekly');
    let notice = $('#sleep-data-notice');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'sleep-data-notice';
      notice.className = 'sleep-data-notice hidden';
      notice.innerHTML = '<strong>V právě načtených datech nejsou spánkové noci.</strong><span>Obnovený soubor v této složce obsahuje 23 nocí. Vyber správnou složku s health-data.json nebo naimportuj Garmin sleepData.json.</span><button class="button button-primary" type="button" data-storage-reselect>Vybrat složku</button>';
      $('#sleep-page-dashboard').before(notice);
    }
    notice.classList.toggle('hidden', source.length > 0);
    const score = average(source, 'sleepScore'), duration = average(source, 'sleepDuration'), deep = average(daily, 'deepSleep'), rem = average(daily, 'remSleep'), spo2 = average(daily, 'spo2Avg');
    $('#sleep-page-count').textContent = `${daily.length || source.length} záznamů`;
    $('#sleep-page-score').textContent = score === null ? '—' : `${score.toFixed(0)} / 100`;
    $('#sleep-page-duration').textContent = fmtDuration(duration);
    $('#sleep-page-deep').textContent = fmtDuration(deep);
    $('#sleep-page-rem').textContent = fmtDuration(rem);
    $('#sleep-page-spo2').textContent = spo2 === null ? '—' : `${spo2.toFixed(1).replace('.', ',')} %`;
    const sleepKeys = ['sleepScore', 'sleepDuration', 'deepSleep', 'lightSleep', 'remSleep', 'restingHr', 'stress', 'spo2Avg', 'bodyBatteryChange', 'breathingAvg'];
    $('#sleep-chart-subtitle').textContent = `${source.length} záznamů · všechny dostupné ukazatele`;
    chartCards($('#sleep-page-trend'), metricDefinitions(sleepKeys, metricInfo), (key) => buildTrend(source, key), (key) => source.some((r) => r[key] != null && r[key] !== '' && Number.isFinite(Number(r[key]))), 'Pro toto období nejsou spánková data.');
    updateComposition(daily, 'sleep-page-composition');
  }
  function renderWeights() {
    const range = getRange(), records = weightRecords.filter((r) => inRange({ date: r.measuredAt.slice(0, 10) }, range));
    const host = $('#weight-records');
    renderWeightDashboard(records);
    $('#weight-count').textContent = `${records.length} měření`;
    if (!records.length) {
      host.className = 'record-list empty-state';
      host.innerHTML = '<span class="empty-icon">◎</span><strong>V tomto období zatím nejsou měření</strong><span>Uprav období výše nebo přidej nové měření z Feelfit.</span>';
      return;
    }
    host.className = 'record-list';
    const details = [['fatFreeWeight', 'Hmotnost bez tuku'], ['subcutaneousFat', 'Podkožní tuk'], ['visceralFat', 'Vnitřní tuk'], ['bodyWater', 'Voda v těle'], ['skeletalMuscle', 'Kosterní svaly'], ['muscleMass', 'Svalová hmota'], ['protein', 'Protein'], ['bmr', 'BMR'], ['boneMass', 'Kostní hmota'], ['metabolicAge', 'Metabolický věk'], ['note', 'Poznámka']];
    host.innerHTML = [...records].sort((a, b) => b.measuredAt.localeCompare(a.measuredAt)).map((r) => `<article class="weight-record"><strong>${esc(fmtDate(r.measuredAt.slice(0, 10)))} · ${esc(r.measuredAt.slice(11, 16))}</strong><b>${esc(weightValueText(weightMetricInfo.weight.get(r), 'kg'))}</b><span>${r.bodyFat !== '' && r.bodyFat != null ? `Tuk ${esc(r.bodyFat)} %` : 'Tuk —'}</span><span>${r.bmi !== '' && r.bmi != null ? `BMI ${esc(r.bmi)}` : 'BMI —'}</span><button class="record-delete" data-delete-weight="${esc(r.id)}" title="Smazat měření" aria-label="Smazat měření">×</button><details class="record-details"><summary>Všechny hodnoty Feelfit</summary><div class="record-extra-grid">${details.map(([key, label]) => { const unit = weightMetricInfo[key]?.unit || '', value = key === 'note' ? r.note : weightMetricInfo[key]?.get(r); const shown = key === 'note' ? (value || '—') : (value === null || value === undefined || value === '' ? '—' : weightValueText(value, unit)); return `<span><small>${esc(label)}</small><strong>${esc(shown)}</strong></span>`; }).join('')}</div></details></article>`).join('');
  }
  function renderImports() {
    const host = $('#import-history-list');
    if (!importRecords.length) {
      host.className = 'table-empty compact-empty';
      host.innerHTML = '<strong>Zatím žádný import</strong><span>Po importu se tu zobrazí názvy souborů.</span>';
      return;
    }
    host.className = '';
    host.innerHTML = `<table class="import-list"><tbody>${importRecords.slice(0, 12).map((r) => `<tr><td>${esc(r.fileName)}</td><td>${esc(r.dateLabel)}</td><td>${r.count} ${r.count === 1 ? 'záznam' : 'záznamů'}</td><td>Načteno</td></tr>`).join('')}</tbody></table>`;
  }
  function updateDashboard() {
    const { range, records } = currentRangeRecords();
    const activities = activityRecords.filter((r) => inRange(r, range));
    const daily = records.filter((r) => r.type !== 'weekly');
    const summary = daily.length ? daily : records.filter((r) => r.type === 'weekly');
    const avgHr = average(daily, 'restingHr'), avgSteps = average(daily, 'steps'), avgScore = average(summary, 'sleepScore'), avgDuration = average(summary, 'sleepDuration'), avgStress = average(daily, 'stress'), avgSpo2 = average(daily, 'spo2Avg');
    setMetric('metric-hr', avgHr, 't/min.'); setMetric('metric-steps', avgSteps, ''); setMetric('metric-sleep-score', avgScore, '/ 100'); setMetric('metric-sleep-duration', avgDuration === null ? null : avgDuration / 60, 'h', 1); setMetric('metric-stress', avgStress, 'bodů'); setMetric('metric-spo2', avgSpo2, '%', 1);
    setNote('note-hr', daily.length ? `Průměr z ${daily.length} denních ${daily.length === 1 ? 'záznamu' : 'záznamů'}` : 'Importuj denní Garmin data');
    setNote('note-steps', avgSteps === null ? 'Kroky přidá Garmin export' : 'Denní průměr v období');
    setNote('note-sleep-score', summary.length ? (daily.length ? 'Průměr z denních záznamů' : 'Týdenní průměry') : 'Průměr za vybrané období');
    setNote('note-sleep-duration', summary.length ? 'Průměrná délka spánku' : 'Průměrná délka noci');
    setNote('note-stress', avgStress === null ? 'Přidá se z denních reportů' : 'Průměrná noční hodnota');
    setNote('note-spo2', avgSpo2 === null ? 'Přidá se z denních reportů' : (daily.some((r) => r.spo2Source === 'denní') ? 'Průměr z denních Garmin dat' : 'Průměr během spánku'));
    $('#stress-status').textContent = avgStress === null ? '—' : avgStress < 25 ? 'Nízký' : avgStress < 50 ? 'Střední' : 'Vyšší';
    $('#steps-progress').style.width = avgSteps === null ? '0%' : `${Math.min(100, avgSteps / 7500 * 100)}%`;
    const rangeChoice = $('#range-select').value;
    $('#range-caption').textContent = rangeChoice === 'all' ? 'Všechna importovaná data' : rangeChoice === 'today' ? `Dnes · ${fmtDate(range.end)}` : rangeChoice === 'yesterday' ? `Včera · ${fmtDate(range.end)}` : rangeChoice === 'month' ? `Tento měsíc · ${fmtDate(range.start)} – ${fmtDate(range.end)}` : rangeChoice === 'previous-month' ? `Minulý měsíc · ${fmtDate(range.start)} – ${fmtDate(range.end)}` : `${fmtDate(range.start)} – ${fmtDate(range.end)}`;
    if ($('#sleep-range-caption')) $('#sleep-range-caption').textContent = $('#range-caption').textContent;
    $('#data-count').textContent = sleepRecords.length ? `${sleepRecords.length} denních záznamů Garminu` : 'Čekám na první import';
    $('#activity-steps').textContent = avgSteps === null ? '—' : Math.round(avgSteps).toLocaleString('cs-CZ');
    $('#activity-calories').textContent = '—';
    $('#activity-count').textContent = '—';
    const distance = activities.reduce((sum, r) => sum + (r.distance || 0), 0);
    const runs = activities.filter((r) => /running|\brun\b|\bbeh\b|trail/.test(`${normalize(r.type)} ${normalize(r.name)}`));
    const runDistance = runs.reduce((sum, r) => sum + (r.distance || 0), 0);
    const avgRunDistance = runs.length ? runDistance / runs.length : null;
    const pacedRuns = runs.filter((r) => Number.isFinite(r.pace) && Number.isFinite(r.distance));
    const avgPace = pacedRuns.reduce((sum, r) => sum + r.pace * r.distance, 0) / (pacedRuns.reduce((sum, r) => sum + r.distance, 0) || NaN);
    const activityHr = average(activities, 'avgHr');
    $('#activity-steps').textContent = avgRunDistance === null ? '—' : `${avgRunDistance.toFixed(1).replace('.', ',')} km`;
    $('#activity-calories').innerHTML = `${distance.toFixed(1).replace('.', ',')} <small>km</small>`;
    $('#activity-count').textContent = activities.length.toLocaleString('cs-CZ');
    $('#activity-avg-pace').textContent = Number.isFinite(avgPace) ? fmtPace(avgPace) : '—';
    $('#activity-avg-hr').textContent = activityHr === null ? '—' : Math.round(activityHr).toLocaleString('cs-CZ');
    renderGarminQuickOverview(records, activities); renderBattery(daily); renderActivityCharts(activities); renderHypothesis(range); renderActivityList(activities); renderOverviewCharts(records, activities, range); renderInsights(); updateTimeline(range);
    const chartKey = $('#chart-metric').value;
    $('#chart-subtitle').textContent = `${metricInfo[chartKey].label} · ${summary.length} ${summary.length === 1 ? 'záznam' : 'záznamů'} v období`;
    $('#trend-chart').innerHTML = buildTrend(chartKey === 'steps' ? records : summary, chartKey);
    updateComposition(daily);
    const sleepOnly = records.filter(isSleepRecord);
    renderSleepDashboard(sleepOnly);
    renderWeights();
    renderRecent(records);
    renderSleepList(sleepOnly);
  }
  function navigate(page) {
    const titles = { overview: 'Přehled', sleep: 'Spánek', activity: 'Aktivita', weight: 'Tělesné hodnoty', insights: 'V\u00fdhled & hypot\u00e9zy', import: 'Import dat' };
    const target = titles[page] ? page : 'overview';
    document.body.dataset.page = target;
    $$('.page').forEach((el) => el.classList.toggle('active', el.id === `page-${target}`));
    $$('.nav-link').forEach((el) => el.classList.toggle('active', el.dataset.page === target));
    $('#crumb-page').textContent = titles[target];
    const range = $('.range-bar'), timeline = $('.timeline-panel'), heading = $(`#page-${target} .page-heading`);
    if (!['insights', 'import'].includes(target) && heading) { heading.after(range); range.after(timeline); }
    updateTimeline(getRange());
    if (location.hash !== `#${target}`) history.replaceState(null, '', `#${target}`);
    if (target === 'weight') renderWeights();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function handleImport(files) {
    const selected = [...files];
    const folderSelection = selected.some((file) => file.webkitRelativePath);
    const candidates = selected.filter((file) => {
      const name = (file.webkitRelativePath || file.name).toLowerCase();
      return (name.endsWith('.csv') && (!folderSelection || isGarminCsvCandidate(name))) || (name.endsWith('.json') && isGarminJsonCandidate(name));
    });
    if (!candidates.length) {
      showImportMessage('Ve výběru jsem nenašel podporované Garmin CSV ani JSON soubory.', true);
      return;
    }
    let addedActivities = 0, mergedActivities = 0, addedDays = 0, mergedDays = 0, failed = 0;
    try {
      for (const file of candidates) {
        const relativeName = file.webkitRelativePath || file.name;
        const isCsv = file.name.toLowerCase().endsWith('.csv');
        const safeSource = isCsv ? file.name : (relativeName.toLowerCase().includes('summarizedactivities') ? 'Garmin JSON – aktivity' : relativeName.toLowerCase().includes('sleepdata') ? 'Garmin JSON – spánek' : relativeName.toLowerCase().includes('hydration') ? 'Garmin JSON – hydratace' : 'Garmin JSON – denní data');
        let kind = 'unknown', parsed = [];
        try {
          const contents = await file.text();
          if (isCsv) {
            parsed = parseActivityCsv(contents, safeSource);
            if (parsed.length) kind = 'activity';
            else { parsed = parseSleepCsv(contents, safeSource); kind = parsed.some((row) => row.type === 'weekly') ? 'weekly' : 'daily'; }
          } else {
            const result = parseGarminJson(contents, relativeName, safeSource);
            kind = result.kind; parsed = result.records;
          }
        } catch { parsed = []; }
        if (!parsed.length) { failed++; continue; }
        for (const record of parsed) {
          if (kind === 'activity') {
            if (upsertActivityRecord(record) === 'added') addedActivities++; else mergedActivities++;
          } else if (kind === 'daily' || kind === 'hydration' || kind === 'weekly') {
            if (upsertDailyRecord(record) === 'added') addedDays++; else mergedDays++;
          }
        }
      }
      writeStore(STORE.sleep, sleepRecords); writeStore(STORE.activity, activityRecords);
      const folderImport = selected.some((file) => file.webkitRelativePath);
      const importName = folderImport ? 'Garmin export · složka' : `Import · ${candidates.length} souborů`;
      importRecords.unshift({ fileName: importName, count: addedActivities + addedDays, dateLabel: fmtDate(new Date().toISOString().slice(0, 10)) });
      writeStore(STORE.imports, importRecords);
      renderImports(); updateDashboard();
      const ignored = selected.length - candidates.length;
      const parts = [`Nově ${addedActivities} aktivit a ${addedDays} denních záznamů.`];
      if (mergedActivities || mergedDays) parts.push(`Sloučeno s existujícími záznamy: ${mergedActivities} aktivit a ${mergedDays} dnů.`);
      if (failed) parts.push(`${failed} souborů nešlo přečíst nebo neobsahovaly známá data.`);
      if (ignored) parts.push(`${ignored} ostatních souborů bylo přeskočeno (např. profily, zařízení a ZIP archivy FIT).`);
      const storageNote = fileStorageActive ? `Data se ukládají do health-data.json ve složce ${dataDirectoryHandle.name}.` : 'Připoj datovou složku v horní liště a data se převedou do health-data.json.';
      showImportMessage(`${parts.join(' ')} Opakovaný import data neduplikuje. ${storageNote}`, failed > 0 && addedActivities + addedDays === 0);
      $('#csv-input').value = ''; $('#folder-input').value = '';
      if (addedActivities + addedDays) showToast(`Import hotov: ${addedActivities} aktivit, ${addedDays} dnů`);
    } catch (error) {
      showImportMessage(`Import se nepodařilo uložit. ${error?.name === 'QuotaExceededError' ? 'V místním úložišti prohlížeče není dost místa.' : 'Zkus vybrat export znovu.'}`, true);
    }
  }
  function showImportMessage(message, error = false) {
    const box = $('#import-feedback');
    box.textContent = message;
    box.className = `import-feedback ${error ? 'error' : 'success'}`;
  }

  mountSharedPeriodControls();
  mountSleepDashboard();
  mountActivityStats();
  mountWeightForm();
  mountWeightDashboard();
  mountGarminQuickOverview();
  mountOverviewHealthCharts();
  mountInsightForecastCharts();
  ['chart-metric', 'overview-activity-metric', 'overview-weight-metric', 'overview-sleep-metric', 'sleep-chart-metric', 'activity-chart-metric', 'weight-chart-metric', 'insight-daily-metric', 'insight-activity-metric', 'insight-weight-metric'].forEach((id) => $(`#${id}`)?.classList.add('hidden'));
  $('#garmin-sync-button').addEventListener('click', async () => {
    const button = $('#garmin-sync-button'), status = $('#garmin-sync-status');
    button.disabled = true;
    button.textContent = 'Synchronizuji…';
    status.textContent = 'Připojuji se ke Garmin Connect. První přihlášení může vyžádat heslo nebo MFA kód v okně Python serveru.';
    try {
      const response = await fetch('/api/garmin/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days: 30 }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Synchronizace se nezdařila.');
      mergeAppData(result.data);
      status.textContent = `Hotovo: ${result.days} denních záznamů a ${result.activities} aktivit. Aktualizováno ${new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}.`;
      showToast('Data z Garmin Connect byla synchronizována.');
    } catch (error) {
      status.textContent = error instanceof SyntaxError
        ? 'Server nevrátil odpověď synchronizace. Spusť py server.py a otevři stránku na jeho adrese.'
        : error.message || 'Synchronizace se nezdařila. Zkontroluj, že běží server a je nastavený .env.';
    } finally {
      button.disabled = false;
      button.textContent = 'Synchronizovat Garmin';
    }
  });
  $$('.nav-link').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.page)));
  $('#storage-folder-button').addEventListener('click', chooseDataSource);
  $('#storage-notice-action').addEventListener('click', chooseDataSource);
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-storage-reselect]')) { connectDataDirectory(); return; }
    const goto = event.target.closest('[data-goto]');
    if (goto) navigate(goto.dataset.goto);
    const del = event.target.closest('[data-delete-weight]');
    if (del) {
      weightRecords = weightRecords.filter((r) => r.id !== del.dataset.deleteWeight);
      writeStore(STORE.weight, weightRecords); updateDashboard(); showToast('Měření bylo smazáno.');
    }
  });
  $('#top-import').addEventListener('click', () => navigate('import'));
  $('#range-select').addEventListener('change', () => {
    $('#custom-range').classList.toggle('hidden', $('#range-select').value !== 'custom');
    saveSelectedRange();
    updateDashboard();
  });
  $('#range-from').addEventListener('change', () => { saveSelectedRange(); updateDashboard(); });
  $('#range-to').addEventListener('change', () => { saveSelectedRange(); updateDashboard(); });
  $('#chart-metric').addEventListener('change', updateDashboard);
  ['overview-activity-metric', 'overview-weight-metric', 'overview-sleep-metric', 'insight-daily-metric', 'insight-activity-metric', 'insight-weight-metric'].forEach((id) => $(`#${id}`).addEventListener('change', updateDashboard));
  $('#sleep-chart-metric').addEventListener('change', updateDashboard);
  $('#activity-chart-metric').addEventListener('change', updateDashboard);
  $('#weight-chart-metric').addEventListener('change', updateDashboard);
  $('#timeline-start').addEventListener('input', () => applyTimelineValues('timeline-start'));
  $('#timeline-end').addEventListener('input', () => applyTimelineValues('timeline-end'));
  $('#timeline-plot').addEventListener('click', (event) => {
    if (!event.target.classList.contains('timeline-track')) return;
    const dates = allDataDates(); if (!dates.length) return;
    const track = $('.timeline-track'), bounds = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const maxDay = Math.max(1, Math.round((new Date(`${dates.at(-1)}T00:00:00`) - new Date(`${dates[0]}T00:00:00`)) / 86400000));
    const value = Math.round(ratio * maxDay), startDistance = Math.abs(value - Number($('#timeline-start').value)), endDistance = Math.abs(value - Number($('#timeline-end').value));
    const target = startDistance < endDistance ? $('#timeline-start') : $('#timeline-end');
    target.value = String(value); applyTimelineValues(target.id);
  });
  $('#csv-input').addEventListener('change', (event) => handleImport(event.target.files));
  $('#folder-input').addEventListener('change', (event) => handleImport(event.target.files));
  $('#load-json-button').addEventListener('click', () => $('#app-json-input').click());
  $('#app-json-input').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (file) await loadAppDataFile(file);
    event.target.value = '';
  });
  $('#body-image-input').addEventListener('change', async (event) => {
    const image = event.target.files?.[0]; if (!image) return;
    const status = $('#body-image-status'); status.textContent = 'Načítám OCR. Při prvním použití se stáhne rozpoznávací model; obrázek zůstává v tomto zařízení.';
    try {
      if (!window.Tesseract) {
        await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'; script.onload = resolve; script.onerror = reject; document.head.append(script); });
      }
      let worker;
      try { worker = await Tesseract.createWorker('ces+eng'); }
      catch { worker = await Tesseract.createWorker('eng'); }
      const result = await worker.recognize(image); await worker.terminate();
      const lines = result.data.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const fields = [
        ['bodyFat', ['telesny tuk', 'telesni tuk']], ['bmi', ['bmi']], ['skeletalMuscle', ['kosterne svaly', 'kosterni svaly']],
        ['muscleMass', ['svalova hmota']], ['protein', ['protein']], ['bmr', ['bmr']], ['fatFreeWeight', ['hmotnost bez tuku']],
        ['subcutaneousFat', ['podkozni tuk']], ['visceralFat', ['vnitrni tuk']], ['bodyWater', ['voda v tele']],
        ['boneMass', ['kostni hmota']], ['metabolicAge', ['metabolicky vek']],
      ];
      const words = result.data.words || [], consumedNumbers = new Set(); let recognized = 0;
      for (const [key, aliases] of fields) {
        let bounds = null;
        for (let i = 0; i < words.length && !bounds; i++) for (const alias of aliases) {
          const parts = alias.split(' '), window = words.slice(i, i + parts.length);
          if (window.length !== parts.length || window.map((word) => normalize(word.text)).join(' ') !== alias) continue;
          bounds = { left: Math.min(...window.map((word) => word.bbox.x0)), right: Math.max(...window.map((word) => word.bbox.x1)), top: Math.min(...window.map((word) => word.bbox.y0)), bottom: Math.max(...window.map((word) => word.bbox.y1)) }; break;
        }
        let raw = null;
        if (bounds) {
          const candidates = words.map((word, index) => ({ word, index, value: String(word.text).match(/\d+(?:[.,]\d+)?/)?.[0] })).filter((entry) => entry.value && !consumedNumbers.has(entry.index) && entry.word.bbox.y0 >= bounds.top - 4 && entry.word.bbox.y0 <= bounds.bottom + 210);
          candidates.sort((a,b) => { const ax=(a.word.bbox.x0+a.word.bbox.x1)/2, bx=(b.word.bbox.x0+b.word.bbox.x1)/2, lx=(bounds.left+bounds.right)/2; const ay=a.word.bbox.y0-bounds.bottom, by=b.word.bbox.y0-bounds.bottom; return (Math.abs(ax-lx)*2+Math.max(0,ay)*.35)-(Math.abs(bx-lx)*2+Math.max(0,by)*.35); });
          if (candidates[0]) { raw = candidates[0].value; consumedNumbers.add(candidates[0].index); }
        }
        if (!raw) for (let i = 0; i < lines.length && !raw; i++) if (aliases.some((alias) => normalize(lines[i]).includes(alias))) {
          const own = lines[i].replace(/[^0-9.,]/g, ' '), following = lines.slice(i+1,i+3).join(' ').replace(/[^0-9.,]/g,' '); raw=(own.match(/\d+(?:[.,]\d+)?/)||following.match(/\d+(?:[.,]\d+)?/))?.[0]||null;
        }
        if (!raw) continue;
        const value = Number(raw.replace(',', '.')), input = $(`[name="${key}"]`, $('#weight-form'));
        if (input && Number.isFinite(value)) { input.value = String(value); recognized++; }
      }
      status.textContent = recognized ? `Předvyplněno ${recognized} hodnot. Projdi je a oprav případné chyby; datum a hmotnost doplň ručně, pokud na obrázku nejsou.` : 'Text se nepodařilo spolehlivě rozpoznat. Hodnoty můžeš zadat ručně; zkus ostřejší screenshot.';
      if (recognized) $('#weight-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      status.textContent = 'OCR se nepodařilo spustit. Zkontroluj připojení pro stažení knihovny/modelu, nebo hodnoty zadej ručně.';
    } finally { event.target.value = ''; }
  });
  const dropzone = $('#dropzone');
  ['dragenter', 'dragover'].forEach((name) => dropzone.addEventListener(name, (event) => { event.preventDefault(); dropzone.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach((name) => dropzone.addEventListener(name, (event) => { event.preventDefault(); dropzone.classList.remove('dragging'); }));
  dropzone.addEventListener('drop', (event) => handleImport(event.dataTransfer.files));
  $('#weight-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const rawNumber = (key) => { const value = String(form.get(key) || '').replace(',', '.').trim(); return value ? Number(value) : ''; };
    const record = { id: crypto.randomUUID(), measuredAt: String(form.get('measuredAt')), weight: rawNumber('weight'), weightUnit: String(form.get('weightUnit')), bmi: rawNumber('bmi'), bodyFat: rawNumber('bodyFat'), fatFreeWeight: rawNumber('fatFreeWeight'), subcutaneousFat: rawNumber('subcutaneousFat'), visceralFat: rawNumber('visceralFat'), bodyWater: rawNumber('bodyWater'), skeletalMuscle: rawNumber('skeletalMuscle'), muscleMass: rawNumber('muscleMass'), protein: rawNumber('protein'), bmr: rawNumber('bmr'), boneMass: rawNumber('boneMass'), metabolicAge: rawNumber('metabolicAge'), note: String(form.get('note') || '').trim() };
    weightRecords.push(record); writeStore(STORE.weight, weightRecords); event.currentTarget.reset(); $('[name="measuredAt"]', event.currentTarget).value = toDateInputValue(new Date()); updateDashboard(); showToast('Měření bylo uloženo.');
  });

  const today = new Date();
  $('#today-label').textContent = new Intl.DateTimeFormat('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' }).format(today).toLocaleUpperCase('cs-CZ');
  const updateLiveClock = () => { $('#live-clock').textContent = new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' }).format(new Date()); };
  updateLiveClock(); setInterval(updateLiveClock, 30_000);
  $('#range-select').value = 'today';
  $('#range-from').value = localDateString(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29));
  $('#range-to').value = localDateString(today);
  restoreSelectedRange();
  $('[name="measuredAt"]').value = toDateInputValue(today);
  if (normalizeStoredActivities()) writeStore(STORE.activity, activityRecords);
  if (normalizeStoredSleepDurations()) writeStore(STORE.sleep, sleepRecords);
  renderImports(); renderWeights(); updateDashboard();
  initializeDataDirectory().then(hydrateFromAppDataFile);
  const initialPage = location.hash.slice(1);
  if (initialPage && $(`#page-${initialPage}`)) navigate(initialPage);
})();
