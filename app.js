// --- STATE MANAGEMENT ---
    const state = {
      records: [],
      referenceDate: localDateISO(),
      referenceDatePinned: false,
      searchQuery: '',
      supplierFilter: 'ALL',
      statusFilter: 'ALL',
      groupBy: 'NONE',
      viewMode: 'SHEET', // 'SHEET' | 'CARDS'
      density: 'COMFORTABLE', // 'COMPACT' | 'COMFORTABLE' | 'SPACIOUS'
      sortField: 'dueDate',
      sortAsc: true,
      selectedRowId: null,
      activePreviewId: null,
      pendingXmlFiles: [],
      pendingBoletoFile: null,
      pendingDanfeFile: null,
      activePaymentRecordId: null,
      history: [],
    };

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[character]);
    }



    function downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename || 'arquivo';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    function csvCell(value) {
      let str = String(value ?? '');
      if (/^[=+\-@\t\r]/.test(str)) {
        str = "'" + str;
      }
      return `"${str.replace(/"/g, '""')}"`;
    }

    function openModal(id, useFlex = false) {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove('hidden');
      if (useFlex) el.classList.add('flex');
    }

    function closeModal(id, useFlex = false) {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.add('hidden');
      if (useFlex) el.classList.remove('flex');
    }

    function localDateISO(date = new Date()) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    function amountToCents(value) {
      const amount = Number(value);
      if (!Number.isFinite(amount)) throw new Error('Valor inválido.');
      const cents = Math.round(amount * 100);
      if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('Valor inválido.');
      return cents;
    }

    const MAX_BOLETO_FILE_SIZE = 5 * 1024 * 1024;
    const MAX_XML_FILE_SIZE = 2 * 1024 * 1024;

    function generateRecordId() {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `bol-${crypto.randomUUID()}`;
      }
      return 'bol-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    }

    function isBoletoFileWithinLimit(file) {
      return Boolean(file && Number.isFinite(file.size) && file.size <= MAX_BOLETO_FILE_SIZE);
    }

    function isXmlWithinLimit(sizeBytes) {
      return Number.isFinite(sizeBytes) && sizeBytes > 0 && sizeBytes <= MAX_XML_FILE_SIZE;
    }

    function calcMod10(numStr) {
      let sum = 0;
      let weight = 2;
      for (let i = numStr.length - 1; i >= 0; i--) {
        let prod = Number(numStr[i]) * weight;
        if (prod > 9) prod = Math.floor(prod / 10) + (prod % 10);
        sum += prod;
        weight = weight === 2 ? 1 : 2;
      }
      const rem = sum % 10;
      return rem === 0 ? 0 : 10 - rem;
    }

    function calcMod11Boleto(numStr) {
      let sum = 0;
      let weight = 2;
      for (let i = numStr.length - 1; i >= 0; i--) {
        sum += Number(numStr[i]) * weight;
        weight = weight === 9 ? 2 : weight + 1;
      }
      const dv = 11 - (sum % 11);
      if (dv === 0 || dv === 10 || dv === 11) return 1;
      return dv;
    }

    function calcMod11Arrecadacao(numStr) {
      let sum = 0;
      let weight = 2;
      for (let i = numStr.length - 1; i >= 0; i--) {
        sum += Number(numStr[i]) * weight;
        weight = weight === 9 ? 2 : weight + 1;
      }
      const rem = sum % 11;
      if (rem === 0 || rem === 1) return 0;
      if (rem === 10) return 1;
      return 11 - rem;
    }

    function validateDigitableLine(value) {
      const digits = String(value || '').replace(/[.\s-]/g, '');
      if (!/^\d{47}$|^\d{48}$/.test(digits)) {
        return { valid: false, label: 'confira os dígitos' };
      }

      if (digits.length === 47) {
        const dv1Ok = calcMod10(digits.slice(0, 9)) === Number(digits[9]);
        const dv2Ok = calcMod10(digits.slice(10, 20)) === Number(digits[20]);
        const dv3Ok = calcMod10(digits.slice(21, 31)) === Number(digits[31]);
        const barcodeWithoutDv =
          digits.slice(0, 4) +
          digits.slice(33, 47) +
          digits.slice(4, 9) +
          digits.slice(10, 20) +
          digits.slice(21, 31);
        const dvGeneralOk = calcMod11Boleto(barcodeWithoutDv) === Number(digits[32]);
        const allOk = dv1Ok && dv2Ok && dv3Ok && dvGeneralOk;
        return { valid: allOk, label: allOk ? 'dígitos ok' : 'dígito verificador inválido' };
      }

      // 48 digits (Arrecadação / Concessionária)
      const idValor = digits[2];
      if (!['6', '7', '8', '9'].includes(idValor)) {
        return { valid: false, label: 'dígito verificador inválido' };
      }
      const calcFn = (idValor === '6' || idValor === '7') ? calcMod10 : calcMod11Arrecadacao;
      let blocksOk = true;
      const blocks = [];
      for (let b = 0; b < 4; b++) {
        const start = b * 12;
        const data11 = digits.slice(start, start + 11);
        const dvBlock = Number(digits[start + 11]);
        if (calcFn(data11) !== dvBlock) blocksOk = false;
        blocks.push(data11);
      }
      const barcode44 = blocks.join('');
      const dvGeneralExpected = Number(barcode44[3]);
      const barcode43 = barcode44.slice(0, 3) + barcode44.slice(4);
      const dvGeneralOk = calcFn(barcode43) === dvGeneralExpected;
      const allOk = blocksOk && dvGeneralOk;
      return { valid: allOk, label: allOk ? 'dígitos ok' : 'dígito verificador inválido' };
    }

    let dbPromise = null;

    function openBoletoDatabase() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) {
          dbPromise = null;
          reject(new Error('IndexedDB não está disponível neste navegador.'));
          return;
        }
        const request = window.indexedDB.open('argon_boletos_files_v1', 3);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('attachments')) {
            db.createObjectStore('attachments', { keyPath: 'recordId' });
          }
          if (!db.objectStoreNames.contains('arquivos')) db.createObjectStore('arquivos', { keyPath: 'key' });
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            db.close();
            dbPromise = null;
          };
          db.onclose = () => {
            dbPromise = null;
          };
          resolve(db);
        };
        request.onerror = () => {
          dbPromise = null;
          reject(request.error || new Error('Não foi possível abrir o armazenamento de anexos.'));
        };
        request.onblocked = () => {
          dbPromise = null;
          reject(new Error('O armazenamento de anexos está ocupado por outra aba.'));
        };
      });
      return dbPromise;
    }

    function withArquivosStore(mode, action) {
      return openBoletoDatabase().then(db => new Promise((resolve, reject) => {
        let result;
        try {
          const tx = db.transaction('arquivos', mode);
          const request = action(tx.objectStore('arquivos'));
          request.onsuccess = () => { result = request.result; };
          request.onerror = () => reject(request.error || new Error('Falha ao acessar anexos.'));
          tx.oncomplete = () => resolve(result);
          tx.onerror = () => reject(tx.error || new Error('Falha ao salvar anexos.'));
          tx.onabort = () => reject(tx.error || new Error('Operação de anexo cancelada.'));
        } catch (error) { reject(error); }
      }));
    }

    function listArquivosMetadata() {
      return openBoletoDatabase().then(db => new Promise((resolve, reject) => {
        const items = [];
        try {
          const tx = db.transaction('arquivos', 'readonly');
          const req = tx.objectStore('arquivos').openCursor();
          req.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
              const val = cursor.value || {};
              items.push({
                key: val.key || cursor.key,
                fileName: val.fileName || val.key || String(cursor.key),
                fileType: val.fileType || '',
                kind: val.kind || 'anexo',
                size: val.file && Number.isFinite(val.file.size) ? val.file.size : 0
              });
              cursor.continue();
            }
          };
          req.onerror = () => reject(req.error || new Error('Falha ao listar metadados dos anexos.'));
          tx.oncomplete = () => resolve(items);
          tx.onerror = () => reject(tx.error || new Error('Falha ao ler metadados dos anexos.'));
        } catch (error) {
          reject(error);
        }
      }));
    }

    function checkArquivosExist(keys) {
      const validKeys = keys.filter(Boolean);
      if (validKeys.length === 0) return Promise.resolve({});
      return openBoletoDatabase().then(db => new Promise((resolve, reject) => {
        const found = {};
        try {
          const tx = db.transaction('arquivos', 'readonly');
          const store = tx.objectStore('arquivos');
          validKeys.forEach(k => {
            const req = store.getKey(k);
            req.onsuccess = () => { found[k] = Boolean(req.result); };
          });
          tx.oncomplete = () => resolve(found);
          tx.onerror = () => reject(tx.error || new Error('Falha ao verificar anexos.'));
        } catch (error) {
          reject(error);
        }
      }));
    }

    function saveArquivo(key, file, kind = '') {
      if (!file || !Number.isFinite(file.size)) return Promise.reject(new Error('Arquivo inválido.'));
      if (kind === 'xml' && file.size > MAX_XML_FILE_SIZE) return Promise.reject(new Error('O arquivo XML deve ter no máximo 2 MB.'));
      if (kind !== 'xml' && file.size > MAX_BOLETO_FILE_SIZE) return Promise.reject(new Error('O arquivo deve ter no máximo 5 MB.'));
      return withArquivosStore('readwrite', store => store.put({ key, file, fileName: file.name || kind, fileType: file.type || 'application/octet-stream', kind }));
    }

    function getArquivo(key) {
      if (!key) return Promise.resolve(null);
      return withArquivosStore('readonly', store => store.get(key));
    }

    function deleteArquivo(key) {
      if (!key) return Promise.resolve();
      return withArquivosStore('readwrite', store => store.delete(key));
    }

    function fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || '');
          const commaIndex = result.indexOf(',');
          resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
        };
        reader.onerror = () => reject(reader.error || new Error('Falha ao codificar arquivo para backup.'));
        reader.readAsDataURL(file);
      });
    }

    function base64ToFile(base64, fileName, fileType) {
      const binary = atob(base64 || '');
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const mime = fileType || 'application/octet-stream';
      try {
        return new File([bytes], fileName || 'anexo', { type: mime });
      } catch (err) {
        const blob = new Blob([bytes], { type: mime });
        blob.name = fileName || 'anexo';
        return blob;
      }
    }

    function isValidCnpj(value) {
      const digits = String(value || '').replace(/\D/g, '');
      if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return false;
      const calcDigit = (base, weights) => {
        const sum = base.split('').reduce((acc, d, idx) => acc + Number(d) * weights[idx], 0);
        const rem = sum % 11;
        return rem < 2 ? 0 : 11 - rem;
      };
      const d1 = calcDigit(digits.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
      const d2 = calcDigit(digits.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
      return d1 === Number(digits[12]) && d2 === Number(digits[13]);
    }

    function openConfirmModal({ title, message, confirmLabel = 'Confirmar', danger = false }) {
      return new Promise((resolve) => {
        const backdrop = document.getElementById('confirmActionModalBackdrop');
        const titleEl = document.getElementById('confirmActionTitle');
        const msgEl = document.getElementById('confirmActionMessage');
        const iconEl = document.getElementById('confirmActionIcon');
        const okBtn = document.getElementById('btnConfirmActionOk');
        const cancelBtn = document.getElementById('btnConfirmActionCancel');

        titleEl.textContent = title || 'Confirmar ação';
        msgEl.textContent = message || '';
        okBtn.textContent = confirmLabel;
        if (danger) {
          iconEl.textContent = '🗑';
          iconEl.className = 'w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 flex items-center justify-center text-lg shrink-0';
          okBtn.className = 'px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white transition';
        } else {
          iconEl.textContent = '⚠️';
          iconEl.className = 'w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 flex items-center justify-center text-lg shrink-0';
          okBtn.className = 'px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-xs font-bold text-white transition';
        }

        const cleanup = (accepted) => {
          backdrop.classList.add('hidden');
          okBtn.removeEventListener('click', onOk);
          cancelBtn.removeEventListener('click', onCancel);
          resolve(accepted);
        };
        const onOk = () => cleanup(true);
        const onCancel = () => cleanup(false);

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        backdrop.classList.remove('hidden');
      });
    }

    function buildPaymentHistoryEntry(record, payment) {
      return {
        id: `pag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        recordId: record.id,
        pagoEm: payment.pagoEm,
        valorPagoCentavos: payment.valorPagoCentavos,
        forma: payment.forma,
        observacao: payment.observacao || '',
        xmlKey: record.xmlKey || '',
        boletoKey: record.boletoKey || '',
        danfeKey: record.danfeKey || '',
        comprovanteKey: payment.comprovanteKey || '',
        estornado: false,
        snapshot: {
          fornecedor: record.supplier || '', cnpj: record.cnpj || '', nfeNumber: record.nfeNumber || '',
          parcela: record.parcela || '', vencimento: record.dueDate || '',
          valorOriginalCentavos: Number(record.amountCents) || 0
        }
      };
    }

    function getPaymentDifferenceCents(entry) {
      return Number(entry.valorPagoCentavos) - Number(entry.snapshot.valorOriginalCentavos);
    }

    function getHistoryPeriodBounds(period, from, to, now = new Date()) {
      if (period === 'custom') return { from: from || '', to: to || '' };
      const year = now.getFullYear(), month = now.getMonth();
      const start = period === 'last' ? new Date(year, month - 1, 1) : new Date(year, month, 1);
      const end = period === 'last' ? new Date(year, month, 0) : new Date(year, month + 1, 0);
      return { from: localDateISO(start), to: localDateISO(end) };
    }

    function filterHistoryEntries(entries, period, from, to, supplier, now = new Date()) {
      const bounds = getHistoryPeriodBounds(period, from, to, now);
      return entries.filter(entry => entry.pagoEm >= bounds.from && entry.pagoEm <= bounds.to &&
        (!supplier || entry.snapshot.fornecedor === supplier));
    }

    function buildHistoryCsv(entries) {
      const money = cents => (Number(cents) / 100).toFixed(2).replace('.', ',');
      const rows = [['Data pago','Fornecedor','CNPJ','NF-e','Parcela','Vencimento','Valor original (R$)','Valor pago (R$)','Diferença (R$)','Forma','Observação','Status']];
      entries.forEach(entry => rows.push([entry.pagoEm, entry.snapshot.fornecedor, entry.snapshot.cnpj, entry.snapshot.nfeNumber,
        entry.snapshot.parcela, entry.snapshot.vencimento, money(entry.snapshot.valorOriginalCentavos), money(entry.valorPagoCentavos),
        money(getPaymentDifferenceCents(entry)), entry.forma, entry.observacao, entry.estornado ? 'ESTORNADO' : 'PAGO']));
      return '\uFEFF' + rows.map(row => row.map(csvCell).join(';')).join('\r\n');
    }

    function paintDigitableStatus(element, value) {
      const result = validateDigitableLine(value);
      element.textContent = result.label;
      element.className = `text-[10px] font-semibold ${result.valid ? 'text-emerald-400' : 'text-rose-300'}`;
    }

    let activeStoredViewerUrl = null;

    function isElectronEnv() {
      return typeof navigator !== 'undefined' && /\bElectron\b/i.test(navigator.userAgent || '');
    }

    function closeStoredFileViewerModal() {
      const backdrop = document.getElementById('storedFileViewerBackdrop');
      const body = document.getElementById('storedFileViewerBody');
      if (backdrop) backdrop.classList.add('hidden');
      if (body) body.innerHTML = '';
      if (activeStoredViewerUrl) {
        URL.revokeObjectURL(activeStoredViewerUrl);
        activeStoredViewerUrl = null;
      }
    }

    function openStoredFileViewerModal(file, fileName) {
      closeStoredFileViewerModal();
      const backdrop = document.getElementById('storedFileViewerBackdrop');
      const titleEl = document.getElementById('storedFileViewerTitle');
      const body = document.getElementById('storedFileViewerBody');
      const dlLink = document.getElementById('storedFileViewerDownload');
      if (!backdrop || !body) return;

      const url = URL.createObjectURL(file);
      activeStoredViewerUrl = url;
      if (titleEl) titleEl.textContent = fileName || file.name || 'Boleto Anexado';
      if (dlLink) {
        dlLink.href = url;
        dlLink.download = fileName || file.name || 'boleto.pdf';
      }

      const mime = String(file.type || '').toLowerCase();
      if (mime.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = fileName || 'Boleto';
        img.className = 'max-w-full max-h-full object-contain rounded-lg';
        body.appendChild(img);
      } else {
        const iframe = document.createElement('iframe');
        iframe.src = url;
        iframe.title = fileName || 'Boleto';
        iframe.className = 'w-full h-full rounded-lg bg-white border-0';
        body.appendChild(iframe);
      }
      backdrop.classList.remove('hidden');
    }

    async function openStoredBoleto(recordId) {
      const useInAppViewer = isElectronEnv();
      let previewWindow = null;

      if (!useInAppViewer) {
        previewWindow = window.open('about:blank', '_blank');
        if (previewWindow) previewWindow.opener = null;
      }

      try {
        const record = state.records.find(item => item.id === recordId);
        const attachment = record && record.boletoKey ? await getArquivo(record.boletoKey) : null;
        if (!attachment || !attachment.file) {
          if (previewWindow) previewWindow.close();
          showToast('Arquivo não encontrado', 'Este registro não tem um arquivo salvo no IndexedDB. Anexe novamente o boleto.', 'warning');
          return;
        }

        if (useInAppViewer || !previewWindow) {
          openStoredFileViewerModal(attachment.file, attachment.fileName || (record && record.boletoFileName) || 'boleto.pdf');
          return;
        }

        const url = URL.createObjectURL(attachment.file);
        previewWindow.location.replace(url);
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (error) {
        if (previewWindow) previewWindow.close();
        showToast('Falha ao abrir boleto', error.message || 'Não foi possível ler o arquivo anexado.', 'warning');
      }
    }

    // LEGADO: migração de registros v0 (amount float -> amountCents). Confirmar antes de remover.
    function migrateRecordsToCents(records) {
      return records.map(record => {
        const fileKey = String(record.xmlFileName || '').replace(/^NFe/, '').replace(/\.xml$/i, '');
        const importKey = record.importKey || (/^\d{44}$/.test(fileKey) && record.parcela
          ? createNfeDuplicateKey(fileKey, record.parcela)
          : '');
        if (Number.isSafeInteger(record.amountCents) && record.amountCents >= 0) {
          const { amount, ...migratedRecord } = record;
          return importKey ? { ...migratedRecord, importKey } : migratedRecord;
        }
        const { amount, ...migratedRecord } = record;
        return { ...migratedRecord, ...(importKey ? { importKey } : {}), amountCents: amountToCents(amount) };
      });
    }

    function createNfeDuplicateKey(accessKey, nDup) {
      return `${String(accessKey || '').replace(/^NFe/, '')}|${String(nDup || '')}`;
    }

    function filterNewImportRecords(records, knownKeys) {
      const newRecords = [];
      let alreadyImported = 0;
      records.forEach(record => {
        if (knownKeys.has(record.importKey)) {
          alreadyImported++;
        } else {
          knownKeys.add(record.importKey);
          newRecords.push(record);
        }
      });
      return { newRecords, alreadyImported };
    }

    function validateBackupRecords(payload) {
      const records = Array.isArray(payload) ? payload : payload && payload.records;
      if (!Array.isArray(records)) return { valid: false, error: 'O arquivo não contém uma lista de boletos.' };
      const valid = records.every(record => record && typeof record === 'object' &&
        typeof record.id === 'string' && record.id.length > 0 &&
        typeof record.supplier === 'string' && record.supplier.trim().length > 0 &&
        typeof record.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record.dueDate) &&
        typeof record.status === 'string' && ['PENDING', 'PAID'].includes(record.status) &&
        ((Number.isSafeInteger(record.amountCents) && record.amountCents >= 0) ||
          (Number.isFinite(Number(record.amount)) && Number(record.amount) >= 0)));
      return valid
        ? { valid: true, records }
        : { valid: false, error: 'O arquivo contém boletos com dados inválidos.' };
    }

    // LEGADO: cópia pré-migração de registros v0. Confirmar antes de remover.
    function savePreMigrationBackup(storage, serializedData) {
      try {
        storage.setItem('argon_backup_pre_migracao', serializedData);
        return storage.getItem('argon_backup_pre_migracao') === serializedData;
      } catch (e) {
        return false;
      }
    }

    function advanceChangeCount(storage) {
      const current = Number.parseInt(storage.getItem('argon_change_count_v1') || '0', 10);
      const next = (Number.isFinite(current) && current >= 0 ? current : 0) + 1;
      storage.setItem('argon_change_count_v1', String(next));
      return next % 10 === 0;
    }

    function loadInitialState() {
      try {
        const history = localStorage.getItem('argon_historico_v1');
        try {
          const parsedHistory = history ? JSON.parse(history) : [];
          state.history = Array.isArray(parsedHistory) ? parsedHistory.filter(entry => entry && typeof entry === 'object' && entry.snapshot && typeof entry.snapshot === 'object') : [];
        } catch (error) { state.history = []; }
        const saved = localStorage.getItem('argon_boletos_xml_state_v1');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            const needsMigration = parsed.some(record => record.amount !== undefined || !Number.isSafeInteger(record.amountCents) || record.amountCents < 0);
            if (needsMigration && !savePreMigrationBackup(localStorage, saved)) {
              state.records = [];
              showToast('Migração não realizada', 'Não foi possível guardar o backup pré-migração. Os dados originais continuam preservados no navegador.', 'warning');
              return;
            }
            state.records = needsMigration ? migrateRecordsToCents(parsed) : parsed;
            if (needsMigration) {
              try {
                localStorage.setItem('argon_boletos_xml_state_v1', JSON.stringify(state.records));
              } catch (e) {
                showToast('Backup pré-migração salvo', 'A conversão será gravada quando houver espaço disponível no navegador.', 'warning');
              }
            }
            return;
          }
        }
      } catch (e) {
        // Ignore storage errors in sandboxed contexts
      }
      state.records = [];
    }

    let saveStateTimer = null;
    let hasPendingStateSave = false;
    let lastSaveFailed = false;

    function flushStateToStorage() {
      if (saveStateTimer) {
        clearTimeout(saveStateTimer);
        saveStateTimer = null;
      }
      hasPendingStateSave = false;
      try {
        localStorage.setItem('argon_boletos_xml_state_v1', JSON.stringify(state.records));
        localStorage.setItem('argon_historico_v1', JSON.stringify(state.history));
        const syncIso = new Date().toISOString();
        lastBaseSyncISO = syncIso;
        try { localStorage.setItem('argon_last_sync_v1', syncIso); } catch (syncErr) {}
        if (advanceChangeCount(localStorage)) {
          showToast('Baixe um backup', 'Você fez 10 alterações desde o último aviso. Baixe um backup para manter uma cópia dos seus boletos.', 'warning');
        }
        lastSaveFailed = false;
        return true;
      } catch (e) {
        lastSaveFailed = true;
        showToast('Erro ao salvar dados', 'Não foi possível salvar. Baixe um backup agora.', 'warning', { persistent: true });
        return false;
      }
    }

    function saveState(options = {}) {
      if (options && options.immediate) {
        return flushStateToStorage();
      }
      hasPendingStateSave = true;
      if (saveStateTimer) clearTimeout(saveStateTimer);
      saveStateTimer = setTimeout(() => {
        flushStateToStorage();
      }, 500);
      return !lastSaveFailed;
    }

    function flushPendingSaves() {
      if (hasPendingStateSave) flushStateToStorage();
    }
    window.addEventListener('pagehide', flushPendingSaves);
    window.addEventListener('beforeunload', flushPendingSaves);

    function saveHistory() {
      try {
        localStorage.setItem('argon_historico_v1', JSON.stringify(state.history));
        return true;
      } catch (e) {
        showToast('Erro ao salvar histórico', 'Não foi possível salvar. Baixe um backup agora.', 'warning', { persistent: true });
        return false;
      }
    }

    function beginPayment(recordId) {
      const record = state.records.find(item => item.id === recordId);
      if (!record) return;
      state.activePaymentRecordId = record.id;
      document.getElementById('paymentDate').value = localDateISO();
      document.getElementById('paymentAmount').value = (Number(record.amountCents) / 100).toFixed(2);
      document.getElementById('paymentMethod').value = 'Boleto';
      document.getElementById('paymentNote').value = '';
      document.getElementById('paymentProof').value = '';
      const modal = document.getElementById('paymentModalBackdrop');
      modal.classList.remove('hidden'); modal.classList.add('flex');
    }

    function undoPayment(recordId) {
      const record = state.records.find(item => item.id === recordId);
      if (!record) return;
      const entry = [...state.history].reverse().find(item => item.recordId === recordId && !item.estornado);
      if (entry) entry.estornado = true;
      record.status = 'PENDING';
      saveState(); renderAll();
      showToast('Pagamento estornado', 'O registro continua no histórico e foi retirado do total pago.', 'info');
    }

    async function openHistoryAttachment(key, fileName) {
      try {
        const saved = await getArquivo(key);
        if (!saved || !saved.file) { showToast('Anexo indisponível', 'O arquivo não foi encontrado neste navegador.', 'warning'); return; }
        downloadBlob(saved.file, fileName || saved.fileName || 'anexo');
      } catch (error) { showToast('Anexo não disponível', 'Falha ao acessar os arquivos guardados neste navegador.', 'warning'); }
    }

    function renderPaymentHistory() {
      const body = document.getElementById('historyTableBody');
      if (!body) return;
      const supplierSelect = document.getElementById('historySupplier');
      const currentSupplier = supplierSelect.value;
      const suppliers = [...new Set(state.history.map(entry => entry.snapshot && entry.snapshot.fornecedor).filter(Boolean))].sort();
      supplierSelect.innerHTML = '<option value="">Todos</option>' + suppliers.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
      supplierSelect.value = suppliers.includes(currentSupplier) ? currentSupplier : '';
      const period = document.getElementById('historyPeriod').value;
      const filtered = filterHistoryEntries(state.history, period, document.getElementById('historyFrom').value, document.getElementById('historyTo').value, supplierSelect.value);
      body.innerHTML = filtered.map(entry => {
        const snap = entry.snapshot || {};
        const difference = getPaymentDifferenceCents(entry);
        const differenceLabel = difference > 0 ? `+${formatCurrencyBRL(difference)} juros/multa` : difference < 0 ? `${formatCurrencyBRL(difference)} desconto` : formatCurrencyBRL(0);
        const fileButton = (key, label, name) => key ? `<button data-history-file="${escapeHtml(key)}" data-file-name="${escapeHtml(name || label)}" class="rounded bg-slate-800 px-2 py-1 text-[10px] text-sky-300">${label}</button>` : '';
        const xml = entry.xmlKey ? fileButton(entry.xmlKey, 'NF-e (XML)', `nfe_${snap.nfeNumber || 'nota'}.xml`) : '<span class="text-amber-300">XML não disponível</span>';
        const danfeKey = entry.danfeKey || '';
        return `<tr class="border-t border-slate-800 ${entry.estornado ? 'line-through opacity-50' : ''}"><td class="p-3">${escapeHtml(formatDateBR(entry.pagoEm))}${entry.estornado ? ' · estornado' : ''}</td><td class="p-3">${escapeHtml(snap.fornecedor)}</td><td class="p-3">${escapeHtml(snap.nfeNumber)}</td><td class="p-3">${escapeHtml(snap.parcela)}</td><td class="p-3">${escapeHtml(formatCurrencyBRL(entry.valorPagoCentavos))}</td><td class="p-3">${escapeHtml(differenceLabel)}</td><td class="p-3"><div class="flex flex-wrap gap-1">${xml}${!entry.xmlKey ? `<label class="cursor-pointer rounded bg-slate-700 px-2 py-1 text-[10px]">Anexar XML<input type="file" accept=".xml,text/xml,application/xml" data-attach-xml="${escapeHtml(entry.id)}" class="hidden"></label>` : ''}${fileButton(entry.boletoKey, 'Boleto', `boleto_${snap.nfeNumber || ''}.pdf`)}${fileButton(entry.comprovanteKey, 'Comprovante', `comprovante_${snap.nfeNumber || ''}`)}${fileButton(danfeKey, 'DANFE', `danfe_${snap.nfeNumber || ''}.pdf`)}</div></td></tr>`;
      }).join('') || '<tr><td colspan="7" class="p-5 text-center text-slate-500">Nenhum pagamento neste período.</td></tr>';
      const total = filtered.filter(entry => !entry.estornado).reduce((sum, entry) => sum + Number(entry.valorPagoCentavos || 0), 0);
      document.getElementById('historyPeriodTotal').textContent = `Total pago no período: ${formatCurrencyBRL(total)}`;
      body.querySelectorAll('[data-history-file]').forEach(button => button.addEventListener('click', () => openHistoryAttachment(button.dataset.historyFile, button.dataset.fileName)));
      body.querySelectorAll('[data-attach-xml]').forEach(input => input.addEventListener('change', async () => {
        const file = input.files && input.files[0]; const entry = state.history.find(item => item.id === input.dataset.attachXml);
        if (!file || !entry) return;
        const key = entry.xmlKey || `historico-xml:${entry.id}`;
        try { await saveArquivo(key, file, 'xml'); entry.xmlKey = key; saveHistory(); renderPaymentHistory(); }
        catch (error) { showToast('Anexos não foram salvos', 'Não foi possível guardar o XML no navegador.', 'warning'); }
      }));
    }

    // --- DATE & URGENCY CALCULATIONS (1-WEEK / 7-DAY NOTIFICATION ENGINE) ---
    function isValidIsoDate(dateStr) {
      if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
      const [y, m, d] = dateStr.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
    }

    function getDaysDifference(dueDateStr, refDateStr) {
      if (!isValidIsoDate(dueDateStr) || !isValidIsoDate(refDateStr)) return null;
      const [dy, dm, dd] = dueDateStr.split('-').map(Number);
      const [ry, rm, rd] = refDateStr.split('-').map(Number);
      const dueUTC = Date.UTC(dy, dm - 1, dd);
      const refUTC = Date.UTC(ry, rm - 1, rd);
      return Math.round((dueUTC - refUTC) / (1000 * 60 * 60 * 24));
    }

    function classifyRecordUrgency(record) {
      const diff = getDaysDifference(record && record.dueDate, state.referenceDate);
      if (record.status === 'PAID') {
        return {
          code: 'PAID',
          label: 'Pago / Baixado',
          shortBadge: '✓ Quitado',
          daysDiff: diff === null ? 0 : diff,
          badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
          rowClass: 'row-paid'
        };
      }
      if (diff === null) {
        return {
          code: 'INVALID_DATE',
          label: 'Data inválida',
          shortBadge: '⚠ Data inválida',
          daysDiff: Number.POSITIVE_INFINITY,
          badgeClass: 'bg-slate-700/60 text-slate-300 border-slate-600',
          rowClass: ''
        };
      }
      if (diff < 0) {
        const absDays = Math.abs(diff);
        return {
          code: 'OVERDUE',
          label: `Vencido há ${absDays} ${absDays === 1 ? 'dia' : 'dias'}`,
          shortBadge: `🚨 Atrasado (${absDays}d)`,
          daysDiff: diff,
          badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
          rowClass: 'row-overdue'
        };
      }
      if (diff <= 7) {
        const dayText = diff === 0 ? 'Vence HOJE!' : diff === 1 ? 'Vence AMANHÃ (1d)' : `Faltam ${diff} dias (≤ 1 sem)`;
        return {
          code: 'WEEK_ALERT',
          label: dayText,
          shortBadge: `🔔 ${dayText}`,
          daysDiff: diff,
          badgeClass: 'bg-amber-500/25 text-amber-200 border-amber-400/60 badge-pulse-week',
          rowClass: 'row-week-alert'
        };
      }
      return {
        code: 'UPCOMING',
        label: `Faltam ${diff} dias`,
        shortBadge: `📅 Em ${diff} dias`,
        daysDiff: diff,
        badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
        rowClass: ''
      };
    }

    function formatCurrencyBRL(val) {
      const num = (Number(val) || 0) / 100;
      return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    function formatDateBR(isoStr) {
      if (!isoStr || !isoStr.includes('-')) return isoStr || '-';
      const [y, m, d] = isoStr.split('-');
      return `${d}/${m}/${y}`;
    }

    function getSupplierInitials(name) {
      if (!name) return 'NF';
      const parts = name.trim().split(/\s+/);
      if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }

    // --- TOAST NOTIFICATIONS ---
    function showToast(title, subtitle, type = 'info', options = {}) {
      const container = document.getElementById('toastContainer');
      if (!container) return;
      const colors = {
        info: 'border-indigo-500/50 bg-[#111827] text-indigo-200',
        warning: 'border-amber-500/60 bg-[#181510] text-amber-200',
        success: 'border-emerald-500/50 bg-[#0d1f1a] text-emerald-200'
      };
      const toast = document.createElement('div');
      toast.className = `pointer-events-auto border rounded-xl p-3.5 shadow-2xl transition-all duration-300 flex items-start justify-between gap-3 ${colors[type] || colors.info}`;
      toast.innerHTML = `
        <div class="text-xs">
          <p class="font-bold text-white mb-0.5">${escapeHtml(title)}</p>
          <p class="text-[11px] opacity-90 whitespace-pre-line">${escapeHtml(subtitle)}</p>
        </div>
        <button type="button" class="text-slate-400 hover:text-white text-xs px-1">✕</button>
      `;
      toast.querySelector('button').addEventListener('click', () => toast.remove());
      container.appendChild(toast);
      if (!options || !options.persistent) {
        setTimeout(() => {
          if (toast.parentNode) toast.remove();
        }, 5000);
      }
    }

    // --- CLIPBOARD HELPER ---
    function copyTextToClipboard(text, label) {
      const fallbackCopy = () => {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
          showToast('Copiado para a área de transferência', `${label}: ${text}`, 'success');
        } catch (err) {
          showToast('Linha selecionada', text, 'info');
        }
        document.body.removeChild(ta);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          showToast('Copiado para a área de transferência', `${label}: ${text}`, 'success');
        }).catch(fallbackCopy);
      } else {
        fallbackCopy();
      }
    }

    // --- SUPPLIER DROPDOWN POPULATION (CACHED BY SUPPLIER SIGNATURE) ---
    let lastSuppliersSignature = '';
    function updateSupplierDropdown() {
      const select = document.getElementById('supplierFilter');
      if (!select) return;
      const currentVal = state.supplierFilter;
      const suppliers = Array.from(new Set(state.records.map(r => r.supplier))).sort();
      const signature = suppliers.join('\x00');
      if (signature !== lastSuppliersSignature) {
        lastSuppliersSignature = signature;
        const frag = document.createDocumentFragment();
        frag.appendChild(new Option(`Todos os Fornecedores (${suppliers.length})`, 'ALL'));
        for (let i = 0; i < suppliers.length; i++) {
          const opt = document.createElement('option');
          opt.value = suppliers[i];
          opt.textContent = suppliers[i];
          frag.appendChild(opt);
        }
        select.replaceChildren(frag);
      }
      if (suppliers.includes(currentVal)) {
        select.value = currentVal;
      } else {
        state.supplierFilter = 'ALL';
        select.value = 'ALL';
      }
    }

    // --- URGENCY MEMOIZATION PER RENDER CYCLE ---
    let currentUrgencyMap = new Map();
    function buildUrgencyMap(records) {
      const map = new Map();
      for (let i = 0; i < records.length; i++) {
        const rec = records[i];
        map.set(rec.id, classifyRecordUrgency(rec));
      }
      currentUrgencyMap = map;
      return map;
    }

    function getRecordUrgency(rec, urgencyMap) {
      if (urgencyMap && urgencyMap.has(rec.id)) return urgencyMap.get(rec.id);
      return classifyRecordUrgency(rec);
    }

    // --- FILTER & SORT LOGIC ---
    function getFilteredAndSortedRecords(urgencyMap = currentUrgencyMap) {
      const q = state.searchQuery.trim().toLowerCase();
      const filtered = state.records.filter(rec => {
        const urgency = getRecordUrgency(rec, urgencyMap);
        if (state.supplierFilter !== 'ALL' && rec.supplier !== state.supplierFilter) {
          return false;
        }
        if (state.statusFilter !== 'ALL' && urgency.code !== state.statusFilter) {
          return false;
        }
        if (q) {
          const hay = `${rec.supplier} ${rec.cnpj} ${rec.nfeNumber} ${rec.parcela} ${(Number(rec.amountCents) / 100).toFixed(2)} ${rec.digitableLine} ${rec.xmlFileName} ${rec.boletoFileName}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });

      const urgencyOrder = { OVERDUE: 0, WEEK_ALERT: 1, UPCOMING: 2, INVALID_DATE: 3, PAID: 4 };

      filtered.sort((a, b) => {
        if (state.groupBy === 'SUPPLIER') {
          const groupCmp = String(a.supplier || '').localeCompare(String(b.supplier || ''), 'pt-BR');
          if (groupCmp !== 0) return groupCmp;
        } else if (state.groupBy === 'URGENCY') {
          const ua = getRecordUrgency(a, urgencyMap).code;
          const ub = getRecordUrgency(b, urgencyMap).code;
          const groupCmp = (urgencyOrder[ua] ?? 9) - (urgencyOrder[ub] ?? 9);
          if (groupCmp !== 0) return groupCmp;
        }

        let cmp = 0;
        if (state.sortField === 'supplier') {
          cmp = String(a.supplier || '').localeCompare(String(b.supplier || ''), 'pt-BR');
        } else if (state.sortField === 'amount') {
          cmp = (Number(a.amountCents) || 0) - (Number(b.amountCents) || 0);
        } else {
          cmp = String(a.dueDate || '').localeCompare(String(b.dueDate || ''));
        }
        return state.sortAsc ? cmp : -cmp;
      });

      return filtered;
    }

    // --- DIRTY VIEW TRACKING & ACTIVE-VIEW-ONLY RENDER ---
    const dirtyViews = {
      SHEET: true,
      CARDS: true,
      HISTORY: true,
      STORAGE: true,
      DRAWER: true
    };

    function renderActiveViewIfDirty(urgencyMap = currentUrgencyMap) {
      if (state.viewMode === 'SHEET' && dirtyViews.SHEET) {
        renderSpreadsheetTable(urgencyMap);
        dirtyViews.SHEET = false;
      } else if (state.viewMode === 'CARDS' && dirtyViews.CARDS) {
        renderKanbanBoard(urgencyMap);
        dirtyViews.CARDS = false;
      } else if (state.viewMode === 'HISTORY' && dirtyViews.HISTORY) {
        renderPaymentHistory();
        dirtyViews.HISTORY = false;
      } else if (state.viewMode === 'STORAGE' && dirtyViews.STORAGE) {
        if (typeof renderStorageBaseView === 'function') renderStorageBaseView();
        dirtyViews.STORAGE = false;
      }
      const drawerEl = document.getElementById('alertsDrawerBackdrop');
      if (drawerEl && !drawerEl.classList.contains('hidden') && dirtyViews.DRAWER) {
        renderAlertsDrawer(urgencyMap);
        dirtyViews.DRAWER = false;
      }
    }

    function renderAll() {
      dirtyViews.SHEET = true;
      dirtyViews.CARDS = true;
      dirtyViews.HISTORY = true;
      dirtyViews.STORAGE = true;
      dirtyViews.DRAWER = true;

      const urgencyMap = buildUrgencyMap(state.records);
      updateSupplierDropdown();
      renderKpisAndBanner(urgencyMap);
      renderActiveViewIfDirty(urgencyMap);
    }

    function renderKpisAndBanner(urgencyMap = currentUrgencyMap) {
      let weekTotal = 0, weekCount = 0;
      let overdueTotal = 0, overdueCount = 0;
      let upcomingTotal = 0, upcomingCount = 0;
      let paidTotal = 0, paidCount = 0;
      let attachedBothCount = 0;
      const weekSuppliers = [];

      for (let i = 0; i < state.records.length; i++) {
        const rec = state.records[i];
        const u = getRecordUrgency(rec, urgencyMap);
        const val = Number(rec.amountCents) || 0;
        if (rec.xmlKey && (rec.boletoKey || rec.boletoFileName)) attachedBothCount++;

        if (u.code === 'WEEK_ALERT') {
          weekTotal += val;
          weekCount++;
          if (weekSuppliers.length < 10) {
            weekSuppliers.push(`${rec.supplier.split(' ')[0]} (${formatDateBR(rec.dueDate)})`);
          }
        } else if (u.code === 'OVERDUE') {
          overdueTotal += val;
          overdueCount++;
        } else if (u.code === 'UPCOMING') {
          upcomingTotal += val;
          upcomingCount++;
        } else if (u.code === 'PAID') {
          paidTotal += val;
          paidCount++;
        }
      }

      document.getElementById('kpiWeekTotal').textContent = formatCurrencyBRL(weekTotal);
      document.getElementById('kpiWeekCount').textContent = `${weekCount} ${weekCount === 1 ? 'boleto vence' : 'boletos vencem'} em ≤ 7d`;

      document.getElementById('kpiOverdueTotal').textContent = formatCurrencyBRL(overdueTotal);
      document.getElementById('kpiOverdueCount').textContent = `${overdueCount} em atraso`;

      document.getElementById('kpiUpcomingTotal').textContent = formatCurrencyBRL(upcomingTotal);
      document.getElementById('kpiUpcomingCount').textContent = `${upcomingCount} para > 7 dias`;

      document.getElementById('kpiPaidTotal').textContent = formatCurrencyBRL(paidTotal);
      document.getElementById('kpiPaidCount').textContent = `${paidCount} liquidado(s)`;

      const rate = state.records.length ? Math.round((attachedBothCount / state.records.length) * 100) : 100;
      document.getElementById('kpiAttachmentRate').textContent = `${rate}%`;
      document.getElementById('kpiXmlLinkedCount').textContent = `${attachedBothCount}/${state.records.length} com XML + Boleto`;

      document.getElementById('headerAlertCount').textContent = String(weekCount);

      const bannerText = document.getElementById('weekAlertBannerText');
      const resetBtn = document.getElementById('btnResetFiltersTop');
      if (state.statusFilter !== 'ALL' || state.supplierFilter !== 'ALL' || state.searchQuery) {
        resetBtn.classList.remove('hidden');
      } else {
        resetBtn.classList.add('hidden');
      }

      if (weekCount > 0) {
        const extraSuffix = weekCount > weekSuppliers.length ? ` e +${weekCount - weekSuppliers.length}` : '';
        bannerText.innerHTML = `<strong>Notificação de 1 Semana Ativa:</strong> Você possui <strong>${weekCount} boleto(s)</strong> (${formatCurrencyBRL(weekTotal)}) vencendo nos próximos 7 dias — Fornecedores: <span class="underline decoration-amber-400/60">${escapeHtml(weekSuppliers.join(', ') + extraSuffix)}</span>.`;
      } else {
        bannerText.innerHTML = `<strong>Radar de 1 Semana Limpo:</strong> Nenhum boleto pendente vence nos próximos 7 dias a partir de ${formatDateBR(state.referenceDate)}.`;
      }
    }

    function getDensityPadding() {
      if (state.density === 'COMPACT') return 'py-1.5 px-3';
      if (state.density === 'SPACIOUS') return 'py-4 px-3.5';
      return 'py-2.5 px-3.5';
    }

    let sheetDelegationBound = false;
    function bindSheetEventDelegation() {
      if (sheetDelegationBound) return;
      const tbody = document.getElementById('sheetTableBody');
      if (!tbody) return;
      sheetDelegationBound = true;

      tbody.addEventListener('change', (e) => {
        const target = e.target;
        if (!target) return;

        if (target.hasAttribute('data-edit-id')) {
          const id = target.getAttribute('data-edit-id');
          const field = target.getAttribute('data-edit-field');
          const rec = state.records.find(r => r.id === id);
          if (!rec) return;

          if (field === 'supplier') {
            const trimmed = target.value.trim();
            if (!trimmed) {
              target.value = rec.supplier;
              showToast('Fornecedor inválido', 'O nome do fornecedor não pode ficar vazio.', 'warning');
              return;
            }
            if (trimmed === rec.supplier) return;
            rec.supplier = trimmed;
          } else if (field === 'dueDate') {
            if (!isValidIsoDate(target.value)) {
              target.value = rec.dueDate;
              showToast('Data inválida', 'Informe uma data de vencimento válida (AAAA-MM-DD).', 'warning');
              return;
            }
            if (target.value === rec.dueDate) return;
            rec.dueDate = target.value;
          } else if (field === 'amount') {
            const parsed = parseFloat(target.value);
            if (isNaN(parsed) || parsed < 0) {
              target.value = (Number(rec.amountCents) / 100).toFixed(2);
              showToast('Valor inválido', 'Informe um valor numérico maior ou igual a zero.', 'warning');
              return;
            }
            let nextCents;
            try {
              nextCents = amountToCents(parsed);
            } catch (err) {
              target.value = (Number(rec.amountCents) / 100).toFixed(2);
              showToast('Valor inválido', 'Informe um valor que possa ser armazenado em centavos inteiros.', 'warning');
              return;
            }
            if (nextCents === rec.amountCents) return;
            rec.amountCents = nextCents;
          } else {
            if (target.value === rec[field]) return;
            rec[field] = target.value;
          }

          const savedOk = saveState();
          renderAll();
          if (savedOk) {
            showToast('Célula atualizada', `${rec.supplier} atualizado na planilha.`, 'info');
          }
          return;
        }

        if (target.hasAttribute('data-status-id')) {
          const id = target.getAttribute('data-status-id');
          const rec = state.records.find(r => r.id === id);
          if (!rec) return;
          if (target.value === 'PAID') beginPayment(id); else undoPayment(id);
          renderAll();
        }
      });

      tbody.addEventListener('click', async (e) => {
        const target = e.target;
        if (!target) return;

        const previewBtn = target.closest('[data-preview-id]');
        if (previewBtn) {
          e.stopPropagation();
          openBoletoPreviewModal(previewBtn.getAttribute('data-preview-id'));
          return;
        }

        const openBoletoBtn = target.closest('[data-open-boleto]');
        if (openBoletoBtn) {
          e.stopPropagation();
          openStoredBoleto(openBoletoBtn.getAttribute('data-open-boleto'));
          return;
        }

        const autoPayBtn = target.closest('[data-autopay-id]');
        if (autoPayBtn) {
          e.stopPropagation();
          openAutoPayModal(autoPayBtn.getAttribute('data-autopay-id'));
          return;
        }

        const copyBtn = target.closest('[data-copy-id]');
        if (copyBtn) {
          e.stopPropagation();
          const rec = state.records.find(r => r.id === copyBtn.getAttribute('data-copy-id'));
          if (rec) copyTextToClipboard(rec.digitableLine, `Boleto ${rec.supplier}`);
          return;
        }

        const deleteBtn = target.closest('[data-delete-id]');
        if (deleteBtn) {
          e.stopPropagation();
          const id = deleteBtn.getAttribute('data-delete-id');
          const rec = state.records.find(r => r.id === id);
          if (!rec) return;

          const confirmed = await openConfirmModal({
            title: 'Confirmar exclusão de boleto',
            message: `Deseja excluir o registro de "${rec.supplier}" no valor de ${formatCurrencyBRL(rec.amountCents)}?\n\nOs anexos exclusivos deste registro serão removidos do navegador. Entradas já registradas no histórico de pagamentos serão preservadas.`,
            confirmLabel: 'Excluir boleto',
            danger: true
          });
          if (!confirmed) return;

          const remainingRecords = state.records.filter(r => r.id !== id);
          state.records = remainingRecords;
          const savedOk = saveState();

          const isKeyStillUsed = (key) => {
            if (!key) return false;
            const usedByOtherRecord = remainingRecords.some(r => r.xmlKey === key || r.danfeKey === key || r.boletoKey === key);
            const usedByHistory = state.history.some(h => h.xmlKey === key || h.danfeKey === key || h.boletoKey === key || h.comprovanteKey === key);
            return usedByOtherRecord || usedByHistory;
          };

          try {
            if (rec.boletoKey && !isKeyStillUsed(rec.boletoKey)) {
              await deleteArquivo(rec.boletoKey);
            }
            if (rec.xmlKey && !isKeyStillUsed(rec.xmlKey)) {
              await deleteArquivo(rec.xmlKey);
            }
            if (rec.danfeKey && !isKeyStillUsed(rec.danfeKey)) {
              await deleteArquivo(rec.danfeKey);
            }
          } catch (cleanupErr) {}

          renderAll();
          recordStorageEvent('EDICAO', `Registro excluído da planilha (${rec.supplier} — ${formatCurrencyBRL(rec.amountCents)})`, rec);
          if (savedOk) {
            showToast('Linha removida', `${rec.supplier} foi removido da planilha.`, 'info');
          }
          return;
        }

        const rowTr = target.closest('tr[data-row-id]');
        if (rowTr) {
          const rowId = rowTr.getAttribute('data-row-id');
          const rowIdx = rowTr.getAttribute('data-row-idx');
          state.selectedRowId = rowId;
          const prevSelected = tbody.querySelector('tr.row-selected');
          if (prevSelected && prevSelected !== rowTr) prevSelected.classList.remove('row-selected');
          rowTr.classList.add('row-selected');
          const rec = state.records.find(r => r.id === rowId);
          if (rec) {
            const urgency = getRecordUrgency(rec, currentUrgencyMap);
            const coord = document.getElementById('activeCellCoord');
            const formula = document.getElementById('activeCellFormulaText');
            if (coord && formula) {
              coord.textContent = `LINHA ${rowIdx}`;
              formula.textContent = `Fornecedor: ${rec.supplier} | Vencimento: ${formatDateBR(rec.dueDate)} (${urgency.label}) | Valor: ${formatCurrencyBRL(rec.amountCents)} | Anexo: ${rec.boletoFileName || 'sem anexo'}`;
            }
          }
        }
      });
    }

    function renderSpreadsheetTable(urgencyMap = currentUrgencyMap) {
      const tbody = document.getElementById('sheetTableBody');
      if (!tbody) return;
      bindSheetEventDelegation();
      const rows = getFilteredAndSortedRecords(urgencyMap);
      const pad = getDensityPadding();

      if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="py-12 text-center text-slate-400">Nenhum boleto encontrado para os filtros selecionados. Clique em <strong>Mostrar Todos</strong> ou importe um novo XML.</td></tr>';
      } else {
        const htmlParts = [];
        let lastGroupKey = null;

        for (let idx = 0; idx < rows.length; idx++) {
          const rec = rows[idx];
          const urgency = getRecordUrgency(rec, urgencyMap);

          if (state.groupBy !== 'NONE') {
            const groupKey = state.groupBy === 'SUPPLIER' ? rec.supplier : urgency.code;
            const groupTitle = state.groupBy === 'SUPPLIER'
              ? `Fornecedor: ${escapeHtml(rec.supplier)} (${escapeHtml(rec.cnpj || 'não informado')})`
              : `Janela de Vencimento: ${escapeHtml(urgency.shortBadge)}`;

            if (groupKey !== lastGroupKey) {
              lastGroupKey = groupKey;
              htmlParts.push(`<tr class="bg-slate-900/95 text-indigo-300 font-bold text-xs"><td colspan="8" class="py-2 px-4 border-b border-slate-800">${groupTitle}</td></tr>`);
            }
          }

          const isSelected = state.selectedRowId === rec.id;
          const safeId = escapeHtml(rec.id);
          const safeSupplier = escapeHtml(rec.supplier);
          const safeCnpj = escapeHtml(rec.cnpj || 'não informado');
          const safeNfe = rec.nfeNumber ? '#' + escapeHtml(rec.nfeNumber) : 'não informado';
          const safeXmlName = escapeHtml(rec.xmlFileName || 'não informado');
          const safeBoletoName = escapeHtml(rec.boletoFileName || 'Anexar boleto');
          const safeBank = escapeHtml(rec.bank || 'Banco não informado');
          const payBtnHtml = rec.status !== 'PAID'
            ? `<button type="button" data-autopay-id="${safeId}" class="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] shadow-sm transition" title="Ir direto para o banco com boleto/NF-e e valor pronto">🏦 Pagar</button>`
            : '';

          htmlParts.push(
            `<tr data-row-id="${safeId}" data-row-idx="${idx + 1}" class="sheet-row ${urgency.rowClass}${isSelected ? ' row-selected' : ''}">` +
            `<td class="${pad} text-center font-mono text-slate-500">${idx + 1}</td>` +
            `<td class="${pad} cell-editable" data-col="A"><div class="flex items-center gap-2.5"><div class="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 font-bold text-[11px] flex items-center justify-center shrink-0">${escapeHtml(getSupplierInitials(rec.supplier))}</div><div class="min-w-0 flex-1"><input type="text" value="${safeSupplier}" data-edit-id="${safeId}" data-edit-field="supplier" class="w-full bg-transparent font-semibold text-white focus:outline-none truncate" title="Clique para editar o nome do fornecedor" /><div class="text-[11px] font-mono text-slate-400 truncate">${safeCnpj}</div></div></div></td>` +
            `<td class="${pad} cell-editable" data-col="B"><div class="flex flex-col gap-1"><div class="flex items-center gap-1.5"><input type="date" value="${escapeHtml(rec.dueDate)}" data-edit-id="${safeId}" data-edit-field="dueDate" class="bg-transparent font-mono font-bold text-slate-100 focus:outline-none cursor-pointer" title="Alterar data de vencimento" /></div><div><span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${urgency.badgeClass}">${escapeHtml(urgency.shortBadge)}</span></div></div></td>` +
            `<td class="${pad} cell-editable font-mono" data-col="C"><div class="flex items-center gap-1"><span class="text-slate-500">R$</span><input type="number" step="0.01" value="${(Number(rec.amountCents) / 100).toFixed(2)}" data-edit-id="${safeId}" data-edit-field="amount" class="w-24 bg-transparent font-bold text-white focus:outline-none" title="Clique para editar o valor do boleto" /></div><span class="text-[10px] text-slate-400">Parc. ${escapeHtml(rec.parcela || 'Única')}</span></td>` +
            `<td class="${pad}"><button type="button" data-preview-id="${safeId}" class="text-left group flex flex-col gap-0.5 p-1.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/25 transition w-full"><div class="flex items-center gap-1.5"><span class="px-1.5 py-0.5 rounded bg-indigo-500/30 text-indigo-200 font-mono text-[10px] font-bold">XML NF-e</span><span class="font-mono font-semibold text-slate-200 text-[11px]">${safeNfe}</span></div><span class="text-[10px] font-mono text-slate-400 truncate max-w-[145px]" title="${safeXmlName}">${safeXmlName}</span></button></td>` +
            `<td class="${pad}"><div class="flex flex-col gap-1"><div class="flex items-center gap-1.5"><button type="button" data-open-boleto="${safeId}" class="flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 font-medium text-[11px] transition truncate max-w-[165px]" title="Abrir Boleto Anexado: ${safeBoletoName}"><span>📎</span><span class="truncate font-mono">${safeBoletoName}</span></button><button type="button" data-copy-id="${safeId}" ${rec.digitableLine && rec.digitableLine.trim() ? 'class="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]" title="Copiar Linha Digitável do Boleto"' : 'disabled class="p-1 rounded bg-slate-800/50 text-slate-500 text-[10px] opacity-40 cursor-not-allowed" title="Sem linha digitável cadastrada"'}>📋</button></div><span class="text-[10px] font-mono text-slate-400 truncate max-w-[195px]">${safeBank}</span></div></td>` +
            `<td class="${pad}"><select data-status-id="${safeId}" class="px-2.5 py-1 rounded-lg text-[11px] font-semibold border focus:outline-none cursor-pointer ${rec.status === 'PAID' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' : 'bg-slate-900 text-slate-200 border-slate-700'}"><option value="PENDING" ${rec.status === 'PENDING' ? 'selected' : ''}>⏳ Em Aberto</option><option value="PAID" ${rec.status === 'PAID' ? 'selected' : ''}>✅ Pago / Baixado</option></select></td>` +
            `<td class="${pad} text-right"><div class="inline-flex items-center gap-1.5">${payBtnHtml}<button type="button" data-open-boleto="${safeId}" class="px-2.5 py-1 rounded-md bg-indigo-600/25 hover:bg-indigo-600/40 text-indigo-200 border border-indigo-500/30 text-[11px] font-semibold transition">Ver Boleto</button><button type="button" data-delete-id="${safeId}" class="p-1.5 rounded-md bg-slate-800/80 hover:bg-rose-500/25 text-slate-400 hover:text-rose-300 transition" title="Remover linha">🗑</button></div></td>` +
            `</tr>`
          );
        }
        tbody.innerHTML = htmlParts.join('');
      }

      let weekSum = 0, openSum = 0, grandSum = 0, xmlCount = 0, boletoCount = 0;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const val = Number(r.amountCents) || 0;
        const u = getRecordUrgency(r, urgencyMap);
        grandSum += val;
        if (r.status !== 'PAID') openSum += val;
        if (u.code === 'WEEK_ALERT') weekSum += val;
        if (r.xmlKey) xmlCount++;
        if (r.boletoFileName || r.boletoKey) boletoCount++;
      }

      document.getElementById('footerRowCount').textContent = String(rows.length);
      document.getElementById('footerXmlCount').textContent = String(xmlCount);
      document.getElementById('footerBoletoCount').textContent = String(boletoCount);
      document.getElementById('footerWeekSum').textContent = formatCurrencyBRL(weekSum);
      document.getElementById('footerOpenSum').textContent = formatCurrencyBRL(openSum);
      document.getElementById('footerGrandSum').textContent = formatCurrencyBRL(grandSum);
    }

    let kanbanDelegationBound = false;
    function bindKanbanEventDelegation() {
      if (kanbanDelegationBound) return;
      const container = document.getElementById('cardsViewContainer');
      if (!container) return;
      kanbanDelegationBound = true;
      container.addEventListener('click', (e) => {
        const previewBtn = e.target && e.target.closest('[data-kanban-preview]');
        if (previewBtn) {
          openBoletoPreviewModal(previewBtn.getAttribute('data-kanban-preview'));
        }
      });
    }

    function renderKanbanBoard(urgencyMap = currentUrgencyMap) {
      bindKanbanEventDelegation();
      const cols = {
        OVERDUE: document.getElementById('kanbanColOverdue'),
        WEEK_ALERT: document.getElementById('kanbanColWeek'),
        UPCOMING: document.getElementById('kanbanColUpcoming'),
        PAID: document.getElementById('kanbanColPaid')
      };
      const buckets = { OVERDUE: [], WEEK_ALERT: [], UPCOMING: [], PAID: [] };
      const rows = getFilteredAndSortedRecords(urgencyMap);

      for (let i = 0; i < rows.length; i++) {
        const rec = rows[i];
        const u = getRecordUrgency(rec, urgencyMap);
        const bucket = buckets[u.code];
        if (!bucket) continue;
        bucket.push(
          `<div class="p-3 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-indigo-500/40 transition flex flex-col gap-2">` +
          `<div class="flex items-start justify-between gap-2"><span class="font-bold text-xs text-white leading-snug">${escapeHtml(rec.supplier)}</span><span class="font-mono text-xs font-bold text-indigo-300 shrink-0">${formatCurrencyBRL(rec.amountCents)}</span></div>` +
          `<div class="flex items-center justify-between text-[11px] text-slate-400 font-mono"><span>Venc: <strong class="text-slate-200">${formatDateBR(rec.dueDate)}</strong></span><span>NF-e ${rec.nfeNumber ? '#' + escapeHtml(rec.nfeNumber) : 'não informado'}</span></div>` +
          `<div class="flex items-center justify-between pt-1"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold border ${u.badgeClass}">${escapeHtml(u.shortBadge)}</span><button type="button" data-kanban-preview="${escapeHtml(rec.id)}" class="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300">📎 Boleto &amp; XML →</button></div>` +
          `</div>`
        );
      }

      Object.keys(cols).forEach(code => {
        if (cols[code]) cols[code].innerHTML = buckets[code].join('');
      });

      document.getElementById('kanbanCountOverdue').textContent = String(buckets.OVERDUE.length);
      document.getElementById('kanbanCountWeek').textContent = String(buckets.WEEK_ALERT.length);
      document.getElementById('kanbanCountUpcoming').textContent = String(buckets.UPCOMING.length);
      document.getElementById('kanbanCountPaid').textContent = String(buckets.PAID.length);
    }

    let drawerDelegationBound = false;
    function bindDrawerEventDelegation() {
      if (drawerDelegationBound) return;
      const list = document.getElementById('alertsDrawerList');
      if (!list) return;
      drawerDelegationBound = true;
      list.addEventListener('click', (e) => {
        const previewBtn = e.target && e.target.closest('[data-drawer-preview]');
        if (previewBtn) {
          closeModal('alertsDrawerBackdrop');
          openBoletoPreviewModal(previewBtn.getAttribute('data-drawer-preview'));
          return;
        }
        const payBtn = e.target && e.target.closest('[data-drawer-pay]');
        if (payBtn) {
          beginPayment(payBtn.getAttribute('data-drawer-pay'));
        }
      });
    }

    function renderAlertsDrawer(urgencyMap = currentUrgencyMap) {
      const list = document.getElementById('alertsDrawerList');
      if (!list) return;
      bindDrawerEventDelegation();

      const alertItems = [];
      for (let i = 0; i < state.records.length; i++) {
        const r = state.records[i];
        const u = getRecordUrgency(r, urgencyMap);
        if (u.code === 'WEEK_ALERT' || u.code === 'OVERDUE') {
          alertItems.push({ rec: r, urgency: u });
        }
      }
      alertItems.sort((a, b) => a.urgency.daysDiff - b.urgency.daysDiff);

      if (alertItems.length === 0) {
        list.innerHTML = '<div class="p-6 text-center text-xs text-slate-400 bg-slate-900/50 rounded-xl border border-slate-800">🎉 Nenhum boleto pendente vence nos próximos 7 dias!</div>';
        return;
      }

      const parts = [];
      for (let i = 0; i < alertItems.length; i++) {
        const { rec, urgency } = alertItems[i];
        const isWeek = urgency.code === 'WEEK_ALERT';
        const safeId = escapeHtml(rec.id);
        parts.push(
          `<div class="p-3.5 rounded-xl border ${isWeek ? 'bg-amber-500/10 border-amber-500/40' : 'bg-rose-500/10 border-rose-500/40'} flex flex-col gap-2">` +
          `<div class="flex items-start justify-between gap-2"><div><span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold mb-1 ${isWeek ? 'bg-amber-500 text-slate-950' : 'bg-rose-500 text-white'}">${escapeHtml(urgency.shortBadge)}</span><h4 class="text-xs font-bold text-white">${escapeHtml(rec.supplier)}</h4><p class="text-[11px] text-slate-400 font-mono">CNPJ/CPF: ${escapeHtml(rec.cnpj || 'não informado')} • NF-e: ${rec.nfeNumber ? '#' + escapeHtml(rec.nfeNumber) : 'não informado'}</p></div><div class="text-right font-mono"><div class="text-sm font-bold text-white">${formatCurrencyBRL(rec.amountCents)}</div><div class="text-[11px] text-amber-300">Venc: ${formatDateBR(rec.dueDate)}</div></div></div>` +
          `<div class="flex items-center justify-between pt-2 border-t border-slate-800/80 text-[11px]"><button type="button" data-drawer-preview="${safeId}" class="font-semibold text-indigo-300 hover:text-white">📎 Abrir Boleto Anexo (${escapeHtml(rec.boletoFileName || 'sem anexo')})</button><button type="button" data-drawer-pay="${safeId}" class="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold">Dar Baixa</button></div>` +
          `</div>`
        );
      }
      list.innerHTML = parts.join('');
    }

    // --- BOLETO & XML PREVIEW MODAL ---
    async function openBoletoPreviewModal(recordId) {
      const rec = state.records.find(r => r.id === recordId);
      if (!rec) return;
      state.activePreviewId = rec.id;

      document.getElementById('previewModalNfeBadge').textContent = rec.nfeNumber ? `NF-e #${rec.nfeNumber}` : 'NF-e não informado';
      document.getElementById('previewModalSupplier').textContent = rec.supplier;
      document.getElementById('boletoBankName').textContent = rec.bank || 'Banco não informado';
      document.getElementById('boletoDigitableLine').textContent = rec.digitableLine || 'não informado';
      document.getElementById('boletoBeneficiario').textContent = rec.supplier;
      document.getElementById('boletoCnpj').textContent = `CNPJ/CPF: ${rec.cnpj || 'não informado'}`;
      document.getElementById('boletoVencimento').textContent = formatDateBR(rec.dueDate);
      document.getElementById('boletoValor').textContent = formatCurrencyBRL(rec.amountCents);
      document.getElementById('boletoDocNum').textContent = rec.nfeNumber || 'não informado';
      document.getElementById('boletoParcela').textContent = rec.parcela;
      document.getElementById('boletoAttachmentName').textContent = rec.boletoFileName || 'não informado';
      document.getElementById('boletoXmlName').textContent = rec.xmlFileName || 'não informado';
      paintDigitableStatus(document.getElementById('previewDigitableStatus'), rec.digitableLine);

      const previewXmlEl = document.getElementById('previewXmlCode');
      if (!rec.xmlKey) {
        previewXmlEl.textContent = 'XML não anexado';
      } else {
        previewXmlEl.textContent = 'Carregando XML anexado...';
        try {
          const savedXml = await getArquivo(rec.xmlKey);
          if (state.activePreviewId !== rec.id) return;
          if (!savedXml || !savedXml.file) {
            previewXmlEl.textContent = 'XML não anexado';
          } else {
            const rawXml = await savedXml.file.text();
            const MAX_PREVIEW_CHARS = 20480;
            previewXmlEl.textContent = rawXml.length > MAX_PREVIEW_CHARS
              ? rawXml.slice(0, MAX_PREVIEW_CHARS) + '\n... [XML truncado acima de 20 KB]'
              : rawXml;
          }
        } catch (err) {
          if (state.activePreviewId === rec.id) {
            previewXmlEl.textContent = 'XML não anexado';
          }
        }
      }

      const payBtn = document.getElementById('btnTogglePaidFromModal');
      if (rec.status === 'PAID') {
        payBtn.textContent = '↩ Reabrir Boleto (Marcar Pendente)';
        payBtn.className = 'px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-xs font-semibold text-white transition';
      } else {
        payBtn.textContent = '✓ Marcar Boleto como Pago';
        payBtn.className = 'px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition';
      }

      openModal('boletoPreviewModalBackdrop');
    }

    // --- REAL BRAZILIAN NF-E XML PARSER ---
    function parseNfeXmlString(xmlString, xmlFileName = 'nfe_importada.xml', attachedBoletoName = '') {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
      const parserError = xmlDoc.querySelector('parsererror');
      if (parserError) {
        throw new Error('Arquivo XML inválido ou mal formatado.');
      }

      const getTagText = (parent, tagName) => {
        if (!parent) return '';
        const el = parent.getElementsByTagName(tagName)[0];
        return el ? el.textContent.trim() : '';
      };

      const emit = xmlDoc.getElementsByTagName('emit')[0];
      const ide = xmlDoc.getElementsByTagName('ide')[0];
      const infNfe = xmlDoc.getElementsByTagName('infNFe')[0];

      const supplierName = getTagText(emit, 'xNome');
      const rawTaxId = getTagText(emit, 'CNPJ') || getTagText(emit, 'CPF');
      const formattedTaxId = rawTaxId.length === 14
        ? `${rawTaxId.slice(0,2)}.${rawTaxId.slice(2,5)}.${rawTaxId.slice(5,8)}/${rawTaxId.slice(8,12)}-${rawTaxId.slice(12,14)}`
        : rawTaxId.length === 11
          ? `${rawTaxId.slice(0,3)}.${rawTaxId.slice(3,6)}.${rawTaxId.slice(6,9)}-${rawTaxId.slice(9,11)}`
          : '';
      const nfeNumber = getTagText(ide, 'nNF');
      const dhEmi = (getTagText(ide, 'dhEmi') || getTagText(ide, 'dEmi') || '').slice(0, 10);
      const required = (value, field) => {
        if (!value) throw new Error(`Campo obrigatório ausente: ${field}`);
        return value;
      };
      required(supplierName, 'emitente');
      required(nfeNumber, 'número da NF');
      required(formattedTaxId, 'CNPJ ou CPF do emitente');
      const accessKeyId = infNfe ? infNfe.getAttribute('Id') : '';
      const nfeKey = String(accessKeyId || '').replace(/^NFe/, '') || `${rawTaxId}${nfeNumber}`;
      const xmlKey = nfeKey;

      // Extract all <dup> (duplicatas / boletos) inside <cobr>
      const dups = Array.from(xmlDoc.getElementsByTagName('dup'));
      const createdRecords = [];

      if (dups.length > 0) {
        dups.forEach((dup, idx) => {
          const nDup = required(getTagText(dup, 'nDup'), 'número da duplicata (nDup)');
          const dVenc = required(getTagText(dup, 'dVenc'), 'vencimento da duplicata (dVenc)');
          const rawAmount = required(getTagText(dup, 'vDup'), 'valor da duplicata (vDup)');
          const vDup = Number(rawAmount);
          const vDupCents = Math.round(vDup * 100);
          if (!Number.isFinite(vDup) || vDup <= 0 || !Number.isSafeInteger(vDupCents)) throw new Error('Campo inválido: valor da duplicata (vDup)');
          const boletoFile = attachedBoletoName || '';

          createdRecords.push({
            id: generateRecordId(),
            importKey: createNfeDuplicateKey(nfeKey, nDup),
            xmlKey,
            danfeKey: '',
            supplier: supplierName,
            cnpj: formattedTaxId,
            nfeNumber: nfeNumber,
            parcela: `${nDup}`,
            issueDate: dhEmi,
            dueDate: dVenc,
            amountCents: vDupCents,
            status: 'PENDING',
            xmlFileName: xmlFileName,
            boletoFileName: boletoFile,
            bank: '',
            digitableLine: '',
          });
        });
      } else {
        throw new Error('Campo ausente: duplicata com vencimento (dVenc) e valor (vDup)');
      }

      return createdRecords;
    }

    // --- EXPORT TO EXCEL-COMPATIBLE CSV ---
    function exportToExcelCsv() {
      const rows = getFilteredAndSortedRecords();
      const headers = [
        'Fornecedor',
        'CNPJ',
        'NF-e Numero',
        'Parcela',
        'Data Vencimento',
        'Dias ate Vencimento',
        'Alerta 1 Semana',
        'Valor (R$)',
        'Status',
        'Arquivo XML Anexo',
        'Arquivo Boleto Anexo',
        'Linha Digitavel'
      ];
      const csvLines = [headers.map(csvCell).join(';')];

      rows.forEach(r => {
        const u = classifyRecordUrgency(r);
        const isWeekAlert = u.code === 'WEEK_ALERT' ? 'SIM (<= 7 DIAS)' : 'NAO';
        const line = [
          r.supplier || '',
          r.cnpj || '',
          r.nfeNumber || '',
          r.parcela || '',
          formatDateBR(r.dueDate),
          Number.isFinite(u.daysDiff) ? u.daysDiff : '',
          isWeekAlert,
          String((Number(r.amountCents || 0) / 100).toFixed(2)).replace('.', ','),
          r.status === 'PAID' ? 'PAGO' : 'PENDENTE',
          r.xmlFileName || '',
          r.boletoFileName || '',
          r.digitableLine || ''
        ];
        csvLines.push(line.map(csvCell).join(';'));
      });

      const blob = new Blob(['\uFEFF' + csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
      downloadBlob(blob, `argon_boletos_xml_${state.referenceDate}.csv`);
      showToast('Planilha exportada com sucesso', 'Arquivo CSV compatível com Microsoft Excel gerado.', 'success');
    }

    // --- EVENT LISTENERS INITIALIZATION ---
    window.addEventListener('DOMContentLoaded', () => {
      state.referenceDate = localDateISO();
      document.getElementById('refDateInput').value = state.referenceDate;
      loadInitialState();
      renderAll();

      // Trigger initial 1-week notification toast on startup
      const initialWeekCount = state.records.filter(r => classifyRecordUrgency(r).code === 'WEEK_ALERT').length;
      if (initialWeekCount > 0) {
        setTimeout(() => {
          showToast(
            `🔔 Alerta de 1 Semana: ${initialWeekCount} boleto(s) próximos`,
            'Existem boletos com vencimento nos próximos 7 dias destacados em âmbar na planilha.',
            'warning'
          );
        }, 400);
      }

      // Close in-app stored file viewer modal
      const closeViewerBtn = document.getElementById('btnCloseStoredFileViewer');
      if (closeViewerBtn) closeViewerBtn.addEventListener('click', closeStoredFileViewerModal);

      // Automatic day rollover check (visibilitychange + every 5 minutes) when not manually pinned
      function checkDayRollover() {
        if (state.referenceDatePinned) return;
        const today = localDateISO();
        if (today !== state.referenceDate) {
          state.referenceDate = today;
          document.getElementById('refDateInput').value = today;
          renderAll();
          const weekCount = state.records.filter(r => getRecordUrgency(r, currentUrgencyMap).code === 'WEEK_ALERT').length;
          if (weekCount > 0) {
            showToast(
              `🔔 Alerta de 1 Semana (${formatDateBR(today)}): ${weekCount} boleto(s) próximos`,
              'O dia virou e há boletos com vencimento nos próximos 7 dias destacados em âmbar.',
              'warning'
            );
          }
        }
      }
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkDayRollover();
      });
      setInterval(checkDayRollover, 5 * 60 * 1000);

      // Reference Date Change
      document.getElementById('refDateInput').addEventListener('change', (e) => {
        if (e.target.value && isValidIsoDate(e.target.value)) {
          state.referenceDate = e.target.value;
          state.referenceDatePinned = (e.target.value !== localDateISO());
          renderAll();
          showToast('Data base recalculada', `Alertas de 7 dias atualizados para ${formatDateBR(state.referenceDate)}.`, 'info');
        }
      });

      document.getElementById('btnReferenceDateToday').addEventListener('click', () => {
        state.referenceDatePinned = false;
        state.referenceDate = localDateISO();
        document.getElementById('refDateInput').value = state.referenceDate;
        renderAll();
      });

      // Search & Filters (200ms debounce on search input)
      let searchDebounceTimer = null;
      document.getElementById('searchInput').addEventListener('input', (e) => {
        const nextQuery = e.target.value;
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
          state.searchQuery = nextQuery;
          renderAll();
        }, 200);
      });

      document.getElementById('supplierFilter').addEventListener('change', (e) => {
        state.supplierFilter = e.target.value;
        renderAll();
      });

      document.getElementById('statusFilter').addEventListener('change', (e) => {
        state.statusFilter = e.target.value;
        renderAll();
      });

      document.getElementById('groupBySelect').addEventListener('change', (e) => {
        state.groupBy = e.target.value;
        renderAll();
      });

      // Banner Quick Filter Buttons
      document.getElementById('btnFilterWeekNow').addEventListener('click', () => {
        state.statusFilter = 'WEEK_ALERT';
        document.getElementById('statusFilter').value = 'WEEK_ALERT';
        renderAll();
      });

      document.getElementById('btnResetFiltersTop').addEventListener('click', () => {
        state.statusFilter = 'ALL';
        state.supplierFilter = 'ALL';
        state.searchQuery = '';
        document.getElementById('statusFilter').value = 'ALL';
        document.getElementById('supplierFilter').value = 'ALL';
        document.getElementById('searchInput').value = '';
        renderAll();
      });

      // KPI Cards Quick Filter Clicks
      const kpiFilterMap = {
        kpiCardWeek: 'WEEK_ALERT',
        kpiCardOverdue: 'OVERDUE',
        kpiCardUpcoming: 'UPCOMING',
        kpiCardPaid: 'PAID',
        kpiCardAll: 'ALL'
      };
      Object.entries(kpiFilterMap).forEach(([cardId, statusCode]) => {
        const cardEl = document.getElementById(cardId);
        if (cardEl) {
          cardEl.addEventListener('click', () => {
            state.statusFilter = statusCode;
            document.getElementById('statusFilter').value = statusCode;
            renderAll();
          });
        }
      });

      // Column Sorting
      document.querySelectorAll('[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
          const field = th.getAttribute('data-sort');
          if (state.sortField === field) {
            state.sortAsc = !state.sortAsc;
          } else {
            state.sortField = field;
            state.sortAsc = true;
          }
          renderAll();
        });
      });

      // View Switcher (Spreadsheet / Kanban / History / Storage)
      const viewBtnSheet = document.getElementById('viewBtnSheet');
      const viewBtnCards = document.getElementById('viewBtnCards');
      const viewBtnHistory = document.getElementById('viewBtnHistory');
      const viewBtnStorage = document.getElementById('viewBtnStorage');

      function setActiveViewTab(mode) {
        state.viewMode = mode;
        const sheetEl = document.getElementById('sheetViewContainer');
        const cardsEl = document.getElementById('cardsViewContainer');
        const histEl = document.getElementById('historyViewContainer');
        const storEl = document.getElementById('storageViewContainer');

        sheetEl.classList.toggle('hidden', mode !== 'SHEET');
        cardsEl.classList.toggle('hidden', mode !== 'CARDS');
        histEl.classList.toggle('hidden', mode !== 'HISTORY');
        histEl.classList.toggle('flex', mode === 'HISTORY');
        storEl.classList.toggle('hidden', mode !== 'STORAGE');
        storEl.classList.toggle('flex', mode === 'STORAGE');

        const activeCls = 'px-3 py-1 rounded-md text-xs font-semibold bg-indigo-600 text-white transition flex items-center gap-1.5';
        const idleCls = 'px-3 py-1 rounded-md text-xs font-medium text-slate-400 hover:text-slate-200 transition flex items-center gap-1.5';
        viewBtnSheet.className = mode === 'SHEET' ? activeCls : idleCls;
        viewBtnCards.className = mode === 'CARDS' ? activeCls : idleCls;
        viewBtnHistory.className = mode === 'HISTORY' ? activeCls : idleCls;
        viewBtnStorage.className = mode === 'STORAGE' ? activeCls : idleCls;

        renderActiveViewIfDirty(currentUrgencyMap);
      }

      viewBtnSheet.addEventListener('click', () => setActiveViewTab('SHEET'));
      viewBtnCards.addEventListener('click', () => setActiveViewTab('CARDS'));
      viewBtnHistory.addEventListener('click', () => setActiveViewTab('HISTORY'));
      viewBtnStorage.addEventListener('click', () => setActiveViewTab('STORAGE'));

      // Density Toggle
      document.getElementById('btnToggleDensity').addEventListener('click', () => {
        const order = ['COMPACT', 'COMFORTABLE', 'SPACIOUS'];
        const labels = { COMPACT: 'Compacta', COMFORTABLE: 'Confortável', SPACIOUS: 'Expandida' };
        const nextIdx = (order.indexOf(state.density) + 1) % order.length;
        state.density = order[nextIdx];
        document.getElementById('densityLabel').textContent = labels[state.density];
        renderSpreadsheetTable();
      });

      // Export CSV
      document.getElementById('btnExportCsv').addEventListener('click', exportToExcelCsv);

      // Local Backup & PWA Install Controls
      let deferredPwaPrompt = null;
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPwaPrompt = e;
      });

      const appDownloadModal = document.getElementById('appDownloadModalBackdrop');
      document.getElementById('btnOpenAppDownloadModal').addEventListener('click', () => {
        openModal('appDownloadModalBackdrop');
      });
      document.getElementById('btnCloseAppDownloadModal').addEventListener('click', () => {
        closeModal('appDownloadModalBackdrop');
      });
      document.getElementById('btnCloseAppDownloadModalBottom').addEventListener('click', () => {
        closeModal('appDownloadModalBackdrop');
      });

      document.getElementById('btnTriggerPwaInstall').addEventListener('click', async () => {
        if (deferredPwaPrompt) {
          deferredPwaPrompt.prompt();
          await deferredPwaPrompt.userChoice;
          deferredPwaPrompt = null;
        } else {
          showToast(
            'Instalação Rápida do Aplicativo',
            'No navegador (Chrome/Edge), clique no ícone "Instalar Argon" na barra de endereços ou consulte as opções de instalação do navegador.',
            'info'
          );
        }
      });

      document.getElementById('btnExportDatabaseJson').addEventListener('click', async () => {
        try {
          let storedFiles = [];
          try {
            const rawFiles = await withArquivosStore('readonly', store => store.getAll());
            storedFiles = Array.isArray(rawFiles) ? rawFiles : [];
          } catch (err) {
            storedFiles = [];
          }

          const serializedFiles = [];
          for (const item of storedFiles) {
            if (item && item.key && item.file) {
              const dataBase64 = await fileToBase64(item.file);
              serializedFiles.push({
                key: item.key,
                fileName: item.fileName || item.file.name || item.key,
                fileType: item.fileType || item.file.type || 'application/octet-stream',
                kind: item.kind || '',
                dataBase64
              });
            }
          }

          const backupPayload = {
            version: 2,
            exportedAt: new Date().toISOString(),
            records: state.records,
            history: state.history,
            paymentSettings,
            files: serializedFiles
          };

          const payload = JSON.stringify(backupPayload, null, 2);
          const blob = new Blob([payload], { type: 'application/json' });
          const FIFTY_MB = 50 * 1024 * 1024;
          if (blob.size > FIFTY_MB) {
            const sizeMb = (blob.size / (1024 * 1024)).toFixed(1);
            showToast(
              'Aviso de tamanho do backup',
              `O arquivo de backup v2 com anexos tem ${sizeMb} MB (acima de 50 MB). O download será iniciado agora.`,
              'warning'
            );
          }

          downloadBlob(blob, `argon_backup_v2_${state.referenceDate}.json`);
          showToast(
            'Backup v2 exportado',
            `${state.records.length} boleto(s), ${state.history.length} histórico(s) e ${serializedFiles.length} anexo(s) salvos.`,
            'success'
          );
        } catch (err) {
          showToast('Erro ao exportar backup', err.message || 'Não foi possível empacotar os anexos do backup.', 'warning');
        }
      });

      document.getElementById('importDatabaseJsonInput').addEventListener('change', async (e) => {
        const file = (e.target.files || [])[0];
        if (!file) return;
        try {
          const text = await file.text();
          const parsed = JSON.parse(text);
          const validation = validateBackupRecords(parsed);
          if (!validation.valid) {
            showToast('Backup recusado', validation.error, 'warning');
            e.target.value = '';
            return;
          }

          const isV2 = parsed && parsed.version === 2 && Array.isArray(parsed.files);
          const filesCount = isV2 ? parsed.files.length : 0;
          const confirmMsg = `Você possui atualmente ${state.records.length} boleto(s) salvos neste navegador.\nO arquivo de backup contém ${validation.records.length} boleto(s)${isV2 ? ` e ${filesCount} anexo(s) (formato v2)` : ' (formato v1)'}.\n\nDeseja substituir os dados atuais pelos do backup? Uma cópia de segurança será salva antes da restauração.`;

          const confirmed = await openConfirmModal({
            title: 'Confirmar restauração de backup',
            message: confirmMsg,
            confirmLabel: 'Restaurar backup',
            danger: false
          });
          if (!confirmed) {
            e.target.value = '';
            return;
          }

          // Save pre-restore safety snapshot (overwriting previous one)
          try {
            localStorage.setItem('argon_backup_pre_restauracao', JSON.stringify({
              savedAt: new Date().toISOString(),
              records: state.records,
              history: state.history,
              paymentSettings
            }));
          } catch (preErr) {
            showToast('Aviso pré-restauração', 'Não foi possível salvar a cópia em argon_backup_pre_restauracao por limite de espaço.', 'warning');
          }

          const requiresMigration = validation.records.some(record => record.amount !== undefined || !Number.isSafeInteger(record.amountCents) || record.amountCents < 0);
          const currentStoredRecords = localStorage.getItem('argon_boletos_xml_state_v1') || '[]';
          if (requiresMigration && !savePreMigrationBackup(localStorage, currentStoredRecords)) {
            showToast('Restauração cancelada', 'Não foi possível guardar a cópia pré-migração no navegador.', 'warning');
            e.target.value = '';
            return;
          }

          state.records = migrateRecordsToCents(validation.records);
          state.history = Array.isArray(parsed.history)
            ? parsed.history.filter(entry => entry && typeof entry === 'object' && entry.snapshot && typeof entry.snapshot === 'object')
            : [];

          // Restore paymentSettings if present (v2)
          if (parsed && parsed.paymentSettings && typeof parsed.paymentSettings === 'object') {
            if (parsed.paymentSettings.defaultBankCode) paymentSettings.defaultBankCode = parsed.paymentSettings.defaultBankCode;
            if (typeof parsed.paymentSettings.customBankUrl === 'string') paymentSettings.customBankUrl = parsed.paymentSettings.customBankUrl;
            if (parsed.paymentSettings.supplierPixKeys && typeof parsed.paymentSettings.supplierPixKeys === 'object') {
              paymentSettings.supplierPixKeys = parsed.paymentSettings.supplierPixKeys;
            }
            savePaymentSettings();
            populateBankSelectors();
          }

          // Restore IndexedDB attachments if backup is v2
          let restoredFilesCount = 0;
          if (isV2) {
            for (const fItem of parsed.files) {
              if (fItem && fItem.key && typeof fItem.dataBase64 === 'string') {
                const rebuiltFile = base64ToFile(fItem.dataBase64, fItem.fileName, fItem.fileType);
                await withArquivosStore('readwrite', store => store.put({
                  key: fItem.key,
                  file: rebuiltFile,
                  fileName: fItem.fileName || fItem.key,
                  fileType: fItem.fileType || 'application/octet-stream',
                  kind: fItem.kind || ''
                }));
                restoredFilesCount++;
              }
            }
          }

          const savedOk = saveState();
          renderAll();
          if (state.viewMode === 'STORAGE') renderStorageBaseView();
          closeModal('appDownloadModalBackdrop');
          if (savedOk) {
            showToast(
              'Base restaurada com sucesso',
              `${state.records.length} boletos${isV2 ? ` e ${restoredFilesCount} anexo(s)` : ''} carregados no aplicativo.`,
              'success'
            );
          }
        } catch (err) {
          showToast('Arquivo JSON inválido', err.message || 'Selecione um backup JSON exportado pelo Argon.', 'warning');
        } finally {
          e.target.value = '';
        }
      });

      // Alerts Drawer Toggle (lazy render when opened if dirty)
      document.getElementById('btnToggleAlertsDrawer').addEventListener('click', () => {
        openModal('alertsDrawerBackdrop');
        if (dirtyViews.DRAWER) {
          renderAlertsDrawer(currentUrgencyMap);
          dirtyViews.DRAWER = false;
        }
      });
      document.getElementById('btnCloseAlertsDrawer').addEventListener('click', () => {
        closeModal('alertsDrawerBackdrop');
      });

      // Upload XML Modal Open/Close
      const uploadModal = document.getElementById('uploadModalBackdrop');
      document.getElementById('btnOpenUploadModal').addEventListener('click', () => {
        openModal('uploadModalBackdrop');
      });
      document.getElementById('btnCloseUploadModal').addEventListener('click', () => {
        closeModal('uploadModalBackdrop');
      });
      document.getElementById('btnCancelUploadModal').addEventListener('click', () => {
        closeModal('uploadModalBackdrop');
      });

      // File Input Listeners inside Upload Modal
      document.getElementById('xmlFileInput').addEventListener('change', (e) => {
        const files = Array.from(e.target.files || []);
        state.pendingXmlFiles = files;
        const statusEl = document.getElementById('xmlSelectedStatus');
        if (files.length > 0) {
          statusEl.textContent = `${files.length} arquivo(s): ${files.map(f => f.name).join(', ')}`;
        } else {
          statusEl.textContent = 'Nenhum XML selecionado';
        }
      });

      document.getElementById('boletoFileInput').addEventListener('change', (e) => {
        const file = (e.target.files || [])[0] || null;
        if (file && !isBoletoFileWithinLimit(file)) {
          state.pendingBoletoFile = null;
          e.target.value = '';
          document.getElementById('boletoSelectedStatus').textContent = 'Arquivo maior que 5 MB';
          showToast('Arquivo muito grande', 'O anexo do boleto deve ter no máximo 5 MB.', 'warning');
          return;
        }
        state.pendingBoletoFile = file;
        const statusEl = document.getElementById('boletoSelectedStatus');
        statusEl.textContent = file ? `Anexo: ${file.name} (limite 5 MB)` : 'Opcional';
      });
      document.getElementById('danfeFileInput').addEventListener('change', e => {
        const file = (e.target.files || [])[0] || null;
        if (file && file.size > MAX_BOLETO_FILE_SIZE) {
          state.pendingDanfeFile = null; e.target.value = '';
          document.getElementById('danfeSelectedStatus').textContent = 'Arquivo maior que 5 MB';
          showToast('Arquivo muito grande', 'O PDF da nota deve ter no máximo 5 MB.', 'warning'); return;
        }
        state.pendingDanfeFile = file;
        document.getElementById('danfeSelectedStatus').textContent = file ? file.name : 'Opcional';
      });

      document.getElementById('btnProcessXmlImport').addEventListener('click', async () => {
        const rawText = document.getElementById('rawXmlTextarea').value.trim();
        const attachedFile = state.pendingBoletoFile;
        const attachedName = attachedFile ? attachedFile.name : '';
        const files = state.pendingXmlFiles;
        if (!files.length && !rawText) {
          showToast('Nenhum XML informado', 'Selecione um arquivo ou cole o conteúdo XML antes de processar.', 'warning');
          return;
        }

        const outcomes = [];
        const knownImportKeys = new Set(state.records.map(record => record.importKey).filter(Boolean));
        let alreadyImported = 0;
        let importedBoletos = 0;
        let attachmentWarnings = 0;
        const inputs = files.length ? files : [{ name: 'nfe_colada_manual.xml', size: new Blob([rawText]).size, text: async () => rawText }];
        const applyAttachedBoleto = Boolean(attachedFile && inputs.length === 1);
        if (attachedFile && inputs.length > 1) {
          showToast(
            'Boleto anexado ignorado no lote',
            'Você selecionou vários XMLs ao mesmo tempo. O boleto anexado só é aplicado automaticamente quando houver 1 XML; anexe os boletos individualmente em cada nota.',
            'warning'
          );
        }
        const effectiveAttachedName = applyAttachedBoleto ? attachedName : '';

        for (const input of inputs) {
          try {
            if (Number.isFinite(input.size) && input.size > MAX_XML_FILE_SIZE) {
              throw new Error('O arquivo XML excede o limite de 2 MB.');
            }
            const xml = await input.text();
            const xmlBytes = new Blob([xml]).size;
            if (!isXmlWithinLimit(xmlBytes)) {
              throw new Error('O conteúdo XML excede o limite de 2 MB.');
            }
            const parsedItems = parseNfeXmlString(xml, input.name, effectiveAttachedName);
            const { newRecords: newItems, alreadyImported: duplicateCount } = filterNewImportRecords(parsedItems, knownImportKeys);
            alreadyImported += duplicateCount;
            if (applyAttachedBoleto && newItems.length > 0) {
              const sharedBoletoKey = `boleto:${newItems[0].id}`;
              try {
                await saveArquivo(sharedBoletoKey, attachedFile, 'boleto');
                newItems.forEach(item => {
                  item.boletoKey = sharedBoletoKey;
                  item.boletoFileName = attachedName;
                });
              } catch (error) {
                newItems.forEach(item => {
                  item.boletoKey = '';
                  item.boletoFileName = '';
                });
                attachmentWarnings += newItems.length;
              }
            }
            const xmlKey = parsedItems[0].xmlKey;
            try {
              if (!await getArquivo(xmlKey)) await saveArquivo(xmlKey, new File([xml], input.name, { type: 'application/xml' }), 'xml');
            } catch (error) { attachmentWarnings++; }
            if (newItems.length) {
              if (state.pendingDanfeFile) {
                try {
                  const danfeKey = `danfe:${xmlKey}`;
                  await saveArquivo(danfeKey, state.pendingDanfeFile, 'danfe');
                  newItems.forEach(item => { item.danfeKey = danfeKey; });
                } catch (error) { attachmentWarnings++; }
              }
            }
            state.records.unshift(...newItems);
            importedBoletos += newItems.length;
            outcomes.push({ ok: true, name: input.name });
          } catch (err) {
            outcomes.push({ ok: false, name: input.name, reason: err.message || 'XML inválido.' });
          }
        }

        if (importedBoletos > 0) saveState();
        renderAll();
        closeModal('uploadModalBackdrop');
        document.getElementById('rawXmlTextarea').value = '';
        state.pendingXmlFiles = [];
        state.pendingBoletoFile = null;
        state.pendingDanfeFile = null;
        document.getElementById('danfeFileInput').value = '';
        const imported = outcomes.filter(item => item.ok).length;
        const refused = outcomes.length - imported;
        const reasons = outcomes.filter(item => !item.ok)
          .map(item => `${item.name}: ${item.reason}`).join('\n');
        const attachmentWarningText = attachmentWarnings
          ? `\nAnexo não salvo em ${attachmentWarnings} boleto(s); tente anexar novamente.`
          : '';
        showToast(
          `${imported} importados, ${refused} recusados`,
          `${importedBoletos} boleto(s) novo(s); ${alreadyImported} já importado(s).${attachmentWarningText}${reasons ? `\n${reasons}` : ''}`,
          refused || attachmentWarnings ? 'warning' : 'success'
        );
      });

      // Boleto Preview Modal Controls
      const previewModal = document.getElementById('boletoPreviewModalBackdrop');
      document.getElementById('btnCloseBoletoPreview').addEventListener('click', () => {
        closeModal('boletoPreviewModalBackdrop');
      });
      document.getElementById('btnCloseBoletoPreviewBottom').addEventListener('click', () => {
        closeModal('boletoPreviewModalBackdrop');
      });
      document.getElementById('btnCopyBarcodeModal').addEventListener('click', () => {
        const rec = state.records.find(r => r.id === state.activePreviewId);
        if (rec) copyTextToClipboard(rec.digitableLine, `Boleto ${rec.supplier}`);
      });
      document.getElementById('btnOpenStoredBoleto').addEventListener('click', () => {
        if (state.activePreviewId) openStoredBoleto(state.activePreviewId);
      });
      document.getElementById('btnTogglePaidFromModal').addEventListener('click', () => {
        const rec = state.records.find(r => r.id === state.activePreviewId);
        if (!rec) return;
        if (rec.status === 'PAID') undoPayment(rec.id); else beginPayment(rec.id);
      });
      document.getElementById('replaceAttachmentInput').addEventListener('change', async (e) => {
        const file = (e.target.files || [])[0];
        const rec = state.records.find(r => r.id === state.activePreviewId);
        if (file && rec) {
          if (!isBoletoFileWithinLimit(file)) {
            e.target.value = '';
            showToast('Arquivo muito grande', 'O anexo do boleto deve ter no máximo 5 MB.', 'warning');
            return;
          }
          const newBoletoKey = `boleto:${rec.id}:${Date.now()}`;
          try {
            await saveArquivo(newBoletoKey, file, 'boleto');
          } catch (error) {
            e.target.value = '';
            showToast('Anexo não salvo', error.message || 'Não foi possível guardar o arquivo no navegador.', 'warning');
            return;
          }
          rec.boletoKey = newBoletoKey;
          rec.boletoFileName = file.name;
          saveState();
          renderAll();
          openBoletoPreviewModal(rec.id);
          showToast('Boleto anexado atualizado', `Arquivo ${file.name} vinculado à NF-e #${rec.nfeNumber}.`, 'success');
        }
        e.target.value = '';
      });

      document.getElementById('cancelPayment').addEventListener('click', () => {
        const modal = document.getElementById('paymentModalBackdrop'); modal.classList.add('hidden'); modal.classList.remove('flex');
      });
      document.getElementById('paymentForm').addEventListener('submit', async event => {
        event.preventDefault();
        const record = state.records.find(item => item.id === state.activePaymentRecordId);
        if (!record) return;
        const file = document.getElementById('paymentProof').files[0];
        if (file && file.size > MAX_BOLETO_FILE_SIZE) { showToast('Arquivo muito grande', 'O comprovante deve ter no máximo 5 MB.', 'warning'); return; }
        let comprovanteKey = '', attachmentsFailed = false, xmlAvailable = Boolean(record.xmlKey);
        if (file) {
          comprovanteKey = `comprovante:${record.id}:${Date.now()}`;
          try { await saveArquivo(comprovanteKey, file, 'comprovante'); }
          catch (error) { comprovanteKey = ''; attachmentsFailed = true; }
        }
        if (record.xmlKey || record.boletoKey) {
          try {
            const existsMap = await checkArquivosExist([record.xmlKey, record.boletoKey]);
            if (record.xmlKey) {
              xmlAvailable = Boolean(existsMap[record.xmlKey]);
              if (!xmlAvailable) attachmentsFailed = true;
            }
            if (record.boletoKey && !existsMap[record.boletoKey]) {
              attachmentsFailed = true;
            }
          } catch (error) {
            if (record.xmlKey) xmlAvailable = false;
            attachmentsFailed = true;
          }
        }
        let entry;
        try {
          entry = buildPaymentHistoryEntry(record, {
            pagoEm: document.getElementById('paymentDate').value,
            valorPagoCentavos: amountToCents(Number(document.getElementById('paymentAmount').value)),
            forma: document.getElementById('paymentMethod').value,
            observacao: document.getElementById('paymentNote').value,
            comprovanteKey
          });
        } catch (error) { showToast('Pagamento inválido', 'Informe uma data e um valor de pagamento válidos.', 'warning'); return; }
        if (!xmlAvailable) entry.xmlKey = '';
        record.status = 'PAID'; state.history.push(entry); saveState(); renderAll();
        const modal = document.getElementById('paymentModalBackdrop'); modal.classList.add('hidden'); modal.classList.remove('flex');
        showToast('Pagamento registrado', attachmentsFailed ? 'anexos não foram salvos' : `${record.supplier} entrou no histórico.`, attachmentsFailed ? 'warning' : 'success');
      });

      ['historyPeriod','historySupplier','historyFrom','historyTo'].forEach(id => document.getElementById(id).addEventListener('change', () => {
        const custom = document.getElementById('historyPeriod').value === 'custom';
        document.getElementById('historyFromWrap').classList.toggle('hidden', !custom);
        document.getElementById('historyToWrap').classList.toggle('hidden', !custom);
        renderPaymentHistory();
      }));
      document.getElementById('btnExportHistoryCsv').addEventListener('click', () => {
        const entries = filterHistoryEntries(state.history, document.getElementById('historyPeriod').value,
          document.getElementById('historyFrom').value, document.getElementById('historyTo').value, document.getElementById('historySupplier').value);
        downloadBlob(new Blob([buildHistoryCsv(entries)], { type: 'text/csv;charset=utf-8;' }), 'argon_historico_pagamentos.csv');
      });

      // New Manual Entry Modal Controls
      const newModal = document.getElementById('newEntryModalBackdrop');
      document.getElementById('btnOpenNewModal').addEventListener('click', () => {
        const dueEl = document.getElementById('inputNewDueDate');
        if (dueEl && !dueEl.value) dueEl.value = localDateISO();
        openModal('newEntryModalBackdrop');
      });
      document.getElementById('btnCloseNewModal').addEventListener('click', () => {
        closeModal('newEntryModalBackdrop');
      });
      document.getElementById('btnCancelNewModal').addEventListener('click', () => {
        closeModal('newEntryModalBackdrop');
      });

      const manualBarcodeInput = document.getElementById('inputNewBarcode');
      const manualBarcodeBadge = document.getElementById('newDigitableStatus');
      manualBarcodeInput.addEventListener('input', () => paintDigitableStatus(manualBarcodeBadge, manualBarcodeInput.value));
      document.getElementById('inputNewAttachment').addEventListener('change', (e) => {
        const file = (e.target.files || [])[0];
        if (file && !isBoletoFileWithinLimit(file)) {
          e.target.value = '';
          showToast('Arquivo muito grande', 'O anexo do boleto deve ter no máximo 5 MB.', 'warning');
        }
      });

      document.getElementById('newEntryForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const supplier = document.getElementById('inputNewSupplier').value.trim();
        const cnpj = document.getElementById('inputNewCnpj').value.trim();
        const nfe = document.getElementById('inputNewNfe').value.trim();
        const dueDate = document.getElementById('inputNewDueDate').value;
        let amountCents;
        try {
          amountCents = amountToCents(Number(document.getElementById('inputNewAmount').value));
        } catch (err) {
          showToast('Valor inválido', 'Informe um valor que possa ser armazenado em centavos inteiros.', 'warning');
          return;
        }
        const barcode = document.getElementById('inputNewBarcode').value.trim();
        const attachmentInput = document.getElementById('inputNewAttachment');
        const attachmentFile = (attachmentInput.files || [])[0];
        if (attachmentFile && !isBoletoFileWithinLimit(attachmentFile)) {
          showToast('Arquivo muito grande', 'O anexo do boleto deve ter no máximo 5 MB.', 'warning');
          return;
        }

        const newRec = {
          id: generateRecordId(),
          supplier,
          cnpj,
          nfeNumber: nfe.replace(/[^0-9A-Za-z-]/g, ''),
          parcela: '01/01',
          issueDate: state.referenceDate,
          dueDate,
          amountCents,
          status: 'PENDING',
          xmlKey: '',
          boletoKey: '',
          xmlFileName: '',
          boletoFileName: attachmentFile ? attachmentFile.name : '',
          bank: '',
          digitableLine: barcode,
        };

        if (attachmentFile) {
          try {
            newRec.boletoKey = `boleto:${newRec.id}`;
            await saveArquivo(newRec.boletoKey, attachmentFile, 'boleto');
          } catch (error) {
            showToast('Anexo não salvo', error.message || 'Não foi possível guardar o arquivo no navegador.', 'warning');
            return;
          }
        }
        state.records.unshift(newRec);
        saveState();
        renderAll();
        closeModal('newEntryModalBackdrop');
        e.target.reset();
        paintDigitableStatus(manualBarcodeBadge, '');
        recordStorageEvent('EDICAO', `Novo boleto manual cadastrado (${supplier})`, newRec);
        showToast('Linha adicionada à planilha', `${supplier} (${formatCurrencyBRL(amountCents)}) salvo com sucesso.`, 'success');
      });

      // =====================================================================
      // BASE DE ARMAZENAMENTO PERMANENTE & BASE DE PAGAMENTO AUTOMÁTICO
      // =====================================================================
      const BRAZIL_BANKS = [
        { code: '341', name: 'Itaú Unibanco', url: 'https://www.itau.com.br/', payHint: 'Pagamentos > Boletos ou PIX Copia e Cola' },
        { code: '237', name: 'Bradesco', url: 'https://banco.bradesco/html/classic/index.shtm', payHint: 'Pagamentos > Boletos / Tributos' },
        { code: '001', name: 'Banco do Brasil', url: 'https://www.bb.com.br/', payHint: 'Pagamentos > Com código de barras ou PIX' },
        { code: '033', name: 'Santander', url: 'https://www.santander.com.br/', payHint: 'Pagamentos > Boleto / Código de barras' },
        { code: '104', name: 'Caixa Econômica Federal', url: 'https://internetbanking.caixa.gov.br/', payHint: 'Pagamentos > Boleto Bancário' },
        { code: '260', name: 'Nubank', url: 'https://app.nubank.com.br/', payHint: 'Pagar > Pagar boleto ou PIX Copia e Cola' },
        { code: '077', name: 'Banco Inter', url: 'https://contadigital.inter.co/', payHint: 'Pagamentos > Boleto / PIX' },
        { code: '336', name: 'C6 Bank', url: 'https://www.c6bank.com.br/', payHint: 'Pagar > Boleto ou PIX' },
        { code: '748', name: 'Sicredi', url: 'https://www.sicredi.com.br/', payHint: 'Pagamentos > Títulos / Boletos' },
        { code: '756', name: 'Sicoob', url: 'https://www.sicoob.com.br/', payHint: 'Pagamentos > Boletos' },
        { code: '208', name: 'BTG Pactual', url: 'https://banking.btgpactual.com/', payHint: 'Pagamentos > Boletos / PIX' },
        { code: '422', name: 'Banco Safra', url: 'https://www.safra.com.br/', payHint: 'Pagamentos > Títulos' },
        { code: '290', name: 'PagBank (PagSeguro)', url: 'https://pagseguro.uol.com.br/', payHint: 'Pagar Contas > Boleto ou PIX' },
        { code: '323', name: 'Mercado Pago', url: 'https://www.mercadopago.com.br/', payHint: 'Pagar boletos e tributos' },
        { code: 'CUSTOM', name: 'Outro Banco (Informar URL personalizada)', url: '', payHint: 'Abre diretamente o link do seu banco' }
      ];

      const paymentSettings = {
        defaultBankCode: '341',
        customBankUrl: '',
        supplierPixKeys: {}
      };

      let storageEvents = [];
      let lastBaseSyncISO = '';
      let activeAutoPayRecordId = null;
      let activeAutoPayMode = 'BOLETO'; // 'BOLETO' | 'NFE' | 'PIX'

      function loadPaymentAndStorageSettings() {
        try {
          const savedSettings = localStorage.getItem('argon_payment_settings_v1');
          if (savedSettings) {
            const parsed = JSON.parse(savedSettings);
            if (parsed.defaultBankCode) paymentSettings.defaultBankCode = parsed.defaultBankCode;
            if (parsed.customBankUrl) paymentSettings.customBankUrl = parsed.customBankUrl;
            if (parsed.supplierPixKeys && typeof parsed.supplierPixKeys === 'object') {
              paymentSettings.supplierPixKeys = parsed.supplierPixKeys;
            }
          }
          const savedEvents = localStorage.getItem('argon_storage_events_v1');
          if (savedEvents) {
            const parsedEv = JSON.parse(savedEvents);
            if (Array.isArray(parsedEv)) storageEvents = parsedEv;
          }
          lastBaseSyncISO = localStorage.getItem('argon_last_sync_v1') || new Date().toISOString();
        } catch (e) {}

        if (storageEvents.length === 0) {
          storageEvents.push({
            id: 'ev-init-' + Date.now(),
            timestamp: new Date().toISOString(),
            type: 'SISTEMA',
            supplier: 'Base de Armazenamento Argon',
            nfeNumber: '-',
            amountCents: 0,
            details: 'Base local permanente inicializada (IndexedDB + LocalStorage).'
          });
        }
      }

      function savePaymentSettings() {
        try {
          localStorage.setItem('argon_payment_settings_v1', JSON.stringify(paymentSettings));
        } catch (e) {
          showToast('Erro ao salvar configurações', 'Não foi possível salvar. Baixe um backup agora.', 'warning', { persistent: true });
        }
      }

      function recordStorageEvent(type, details, record = null) {
        const entry = {
          id: 'ev-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          timestamp: new Date().toISOString(),
          type,
          supplier: record ? record.supplier : 'Sistema Argon',
          nfeNumber: record ? (record.nfeNumber || '-') : '-',
          amountCents: record ? (Number(record.amountCents) || 0) : 0,
          details
        };
        storageEvents.unshift(entry);
        if (storageEvents.length > 300) storageEvents = storageEvents.slice(0, 300);

        try {
          localStorage.setItem('argon_storage_events_v1', JSON.stringify(storageEvents));
        } catch (e) {}

        dirtyViews.STORAGE = true;
        if (state.viewMode === 'STORAGE') {
          renderStorageBaseView();
          dirtyViews.STORAGE = false;
        }
      }

      // EMV BR Code (PIX Copia e Cola) generator with exact CRC16-CCITT and fixed amount
      function emvField(id, value) {
        const str = String(value || '');
        const len = String(str.length).padStart(2, '0');
        return `${id}${len}${str}`;
      }

      function crc16Ccitt(payload) {
        let crc = 0xFFFF;
        for (let i = 0; i < payload.length; i++) {
          crc ^= payload.charCodeAt(i) << 8;
          for (let j = 0; j < 8; j++) {
            crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
            crc &= 0xFFFF;
          }
        }
        return crc.toString(16).toUpperCase().padStart(4, '0');
      }

      function isValidCpf(value) {
        const digits = String(value || '').replace(/\D/g, '');
        if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
        const calc = (len) => {
          let sum = 0;
          for (let i = 0; i < len; i++) sum += Number(digits[i]) * (len + 1 - i);
          const rem = (sum * 10) % 11;
          return rem === 10 ? 0 : rem;
        };
        return calc(9) === Number(digits[9]) && calc(10) === Number(digits[10]);
      }

      function normalizePixKey(rawKey) {
        const trimmed = String(rawKey || '').trim();
        if (!trimmed) return '';
        // UUID (chave aleatória) intacta
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
          return trimmed;
        }
        // E-mail em minúsculas
        if (trimmed.includes('@')) {
          return trimmed.toLowerCase();
        }
        // Telefone já com + internacional
        if (trimmed.startsWith('+')) {
          return '+' + trimmed.replace(/\D/g, '');
        }
        const digits = trimmed.replace(/\D/g, '');
        // CNPJ com ou sem pontuação -> só dígitos
        if (digits.length === 14 && isValidCnpj(digits)) {
          return digits;
        }
        // CPF com ou sem pontuação -> só dígitos (se não tiver cara de telefone com parênteses)
        if (digits.length === 11 && !trimmed.includes('(') && isValidCpf(digits)) {
          return digits;
        }
        // Telefone brasileiro (10 ou 11 dígitos) -> +55...
        if ((digits.length === 10 || digits.length === 11) && /^[\d\s().-]+$/.test(trimmed)) {
          return '+55' + digits;
        }
        // Telefone já com DDI 55 (12 ou 13 dígitos) -> +55...
        if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55') && /^[\d\s().-]+$/.test(trimmed)) {
          return '+' + digits;
        }
        return trimmed;
      }

      function getSupplierPixStorageKey(rec) {
        if (!rec) return '';
        const digits = String(rec.cnpj || '').replace(/\D/g, '');
        if (digits.length === 14 && isValidCnpj(digits)) return `cnpj:${digits}`;
        if (digits.length === 11 && isValidCpf(digits)) return `cpf:${digits}`;
        return rec.supplier || '';
      }

      function getSavedPixKeyForRecord(rec) {
        if (!rec) return '';
        const primaryKey = getSupplierPixStorageKey(rec);
        if (primaryKey && paymentSettings.supplierPixKeys[primaryKey]) {
          return paymentSettings.supplierPixKeys[primaryKey];
        }
        if (rec.supplier && paymentSettings.supplierPixKeys[rec.supplier]) {
          return paymentSettings.supplierPixKeys[rec.supplier];
        }
        return '';
      }

      function setSavedPixKeyForRecord(rec, rawKey) {
        if (!rec) return;
        const primaryKey = getSupplierPixStorageKey(rec);
        if (primaryKey) paymentSettings.supplierPixKeys[primaryKey] = normalizePixKey(rawKey);
      }

      function buildPixCopiaECola(pixKey, merchantName, amountCents, txIdRef) {
        const cleanKey = normalizePixKey(pixKey);
        if (!cleanKey) return '';
        const cleanName = String(merchantName || 'FORNECEDOR')
          .normalize('NFD').replace(/[̀-ͯ]/g, '')
          .replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, 25).toUpperCase() || 'FORNECEDOR';
        const amountStr = (Math.max(0, Number(amountCents) || 0) / 100).toFixed(2);
        const cleanTx = String(txIdRef || 'ARGON').replace(/[^A-Za-z0-9]/g, '').slice(0, 20) || 'ARGON';

        const merchantAccount = emvField('00', 'br.gov.bcb.pix') + emvField('01', cleanKey);
        const additionalData = emvField('05', cleanTx);

        const payloadWithoutCrc =
          emvField('00', '01') +
          emvField('26', merchantAccount) +
          emvField('52', '0000') +
          emvField('53', '986') +
          emvField('54', amountStr) +
          emvField('58', 'BR') +
          emvField('59', cleanName) +
          emvField('60', 'BRASIL') +
          emvField('62', additionalData) +
          '6304';

        return payloadWithoutCrc + crc16Ccitt(payloadWithoutCrc);
      }

      function detectBankFromDigitableLine(digitableLine) {
        const digits = String(digitableLine || '').replace(/\D/g, '');
        if (digits.length >= 3) {
          const code = digits.slice(0, 3);
          const found = BRAZIL_BANKS.find(b => b.code === code);
          if (found) return found;
        }
        return null;
      }

      function populateBankSelectors() {
        const selects = [
          document.getElementById('autoPayBankSelect'),
          document.getElementById('storageDefaultBankSelect')
        ];
        selects.forEach(sel => {
          if (!sel) return;
          sel.innerHTML = '';
          BRAZIL_BANKS.forEach(bank => {
            const opt = document.createElement('option');
            opt.value = bank.code;
            opt.textContent = bank.code === 'CUSTOM' ? bank.name : `${bank.code} — ${bank.name}`;
            sel.appendChild(opt);
          });
          sel.value = paymentSettings.defaultBankCode || '341';
        });
        const customStorageInput = document.getElementById('storageCustomBankUrlInput');
        if (customStorageInput) {
          customStorageInput.value = paymentSettings.customBankUrl || '';
          customStorageInput.classList.toggle('hidden', paymentSettings.defaultBankCode !== 'CUSTOM');
        }
      }

      function updateAutoPayCodePreview() {
        const rec = state.records.find(r => r.id === activeAutoPayRecordId);
        if (!rec) return;

        const btnBol = document.getElementById('autoPayModeBoleto');
        const btnNfe = document.getElementById('autoPayModeNfe');
        const btnPix = document.getElementById('autoPayModePix');
        const pixWrap = document.getElementById('autoPayPixKeyWrap');
        const labelEl = document.getElementById('autoPayCodeLabel');
        const valEl = document.getElementById('autoPayCodeValue');
        const hintEl = document.getElementById('autoPayCodeHint');

        const activeBtn = 'py-2 px-2.5 rounded-lg font-bold bg-indigo-600 text-white border border-indigo-400/50 transition';
        const idleBtn = 'py-2 px-2.5 rounded-lg font-medium bg-slate-900 text-slate-300 border border-slate-700 hover:text-white transition';

        btnBol.className = activeAutoPayMode === 'BOLETO' ? activeBtn : idleBtn;
        btnNfe.className = activeAutoPayMode === 'NFE' ? activeBtn : idleBtn;
        btnPix.className = activeAutoPayMode === 'PIX' ? activeBtn : idleBtn;
        pixWrap.classList.toggle('hidden', activeAutoPayMode !== 'PIX');

        if (activeAutoPayMode === 'BOLETO') {
          labelEl.textContent = `Linha Digitável do Boleto Pronta (Valor: ${formatCurrencyBRL(rec.amountCents)}):`;
          valEl.value = rec.digitableLine || '';
          hintEl.textContent = 'Ao clicar em "Ir Direto para o Banco", a linha digitável é copiada automaticamente para você colar no campo de pagamento de boletos do banco.';
        } else if (activeAutoPayMode === 'NFE') {
          const nfeKeyClean = String(rec.xmlKey || rec.xmlFileName || rec.nfeNumber || '')
            .replace(/^NFe/i, '').replace(/\.xml$/i, '');
          labelEl.textContent = `Código / Chave de Acesso da NF-e #${rec.nfeNumber} (Valor: ${formatCurrencyBRL(rec.amountCents)}):`;
          valEl.value = nfeKeyClean;
          hintEl.textContent = 'Código da Nota Fiscal pronto para conferência, DDA bancário ou lançamento de pagamento com o valor exato definido.';
        } else {
          const supplierKey = getSavedPixKeyForRecord(rec);
          const pixInput = document.getElementById('autoPayPixKeyInput');
          if (!pixInput.value && supplierKey) pixInput.value = supplierKey;
          const activeKey = pixInput.value.trim();
          labelEl.textContent = `PIX Copia e Cola com Valor Travado (${formatCurrencyBRL(rec.amountCents)}):`;
          if (activeKey) {
            valEl.value = buildPixCopiaECola(activeKey, rec.supplier, rec.amountCents, `NFE${rec.nfeNumber || '001'}`);
            hintEl.textContent = `Payload PIX oficial gerado com o valor exato de ${formatCurrencyBRL(rec.amountCents)} já embutido! Cole no "PIX Copia e Cola" do seu banco.`;
          } else {
            valEl.value = '';
            hintEl.textContent = 'Informe a chave PIX do fornecedor acima (ou clique em "Usar CNPJ do XML") para gerar o PIX Copia e Cola já com o valor travado.';
          }
        }
      }

      window.openAutoPayModal = function openAutoPayModal(recordId) {
        const rec = state.records.find(r => r.id === recordId);
        if (!rec) return;
        activeAutoPayRecordId = rec.id;
        activeAutoPayMode = rec.digitableLine ? 'BOLETO' : 'NFE';

        const urgency = classifyRecordUrgency(rec);
        const issuer = detectBankFromDigitableLine(rec.digitableLine);

        document.getElementById('autoPaySupplier').textContent = rec.supplier;
        document.getElementById('autoPayMeta').textContent = `CNPJ: ${rec.cnpj || 'não informado'} • NF-e: ${rec.nfeNumber ? '#' + rec.nfeNumber : 'não informado'} • Parc. ${rec.parcela || 'Única'}`;
        document.getElementById('autoPayAmountDisplay').textContent = formatCurrencyBRL(rec.amountCents);
        document.getElementById('autoPayDueBadge').textContent = `Venc: ${formatDateBR(rec.dueDate)} (${urgency.label})`;
        document.getElementById('autoPayDetectedIssuer').textContent = issuer
          ? `Banco Emissor do Boleto: ${issuer.code} — ${issuer.name}`
          : (rec.bank ? `Banco Emissor: ${rec.bank}` : 'Pronto para envio ao seu banco pagador');

        const bankSelect = document.getElementById('autoPayBankSelect');
        bankSelect.value = paymentSettings.defaultBankCode || (issuer ? issuer.code : '341');
        const customInput = document.getElementById('autoPayCustomBankUrl');
        customInput.value = paymentSettings.customBankUrl || '';
        customInput.classList.toggle('hidden', bankSelect.value !== 'CUSTOM');

        document.getElementById('autoPayPixKeyInput').value = getSavedPixKeyForRecord(rec);
        updateAutoPayCodePreview();

        openModal('autoPayModalBackdrop');
      };

      async function renderStorageBaseView() {
        document.getElementById('storageStatRecords').textContent = String(state.records.length);
        document.getElementById('storageStatEvents').textContent = String(storageEvents.length);

        const defaultBankObj = BRAZIL_BANKS.find(b => b.code === paymentSettings.defaultBankCode) || BRAZIL_BANKS[0];
        document.getElementById('storageStatDefaultBank').textContent = `Banco padrão: ${defaultBankObj.name}`;
        document.getElementById('storageStatLastSync').textContent = lastBaseSyncISO
          ? new Date(lastBaseSyncISO).toLocaleString('pt-BR')
          : 'Sincronizado';

        // Render Audit/Event Log Table
        const filterVal = document.getElementById('storageLogFilter').value;
        const tbody = document.getElementById('storageLogTableBody');
        tbody.innerHTML = '';
        const filteredEvents = storageEvents.filter(ev => filterVal === 'ALL' || ev.type === filterVal);

        if (filteredEvents.length === 0) {
          tbody.innerHTML = '<tr><td colspan="4" class="p-6 text-center text-slate-500">Nenhum evento registrado neste filtro.</td></tr>';
        } else {
          filteredEvents.forEach(ev => {
            const typeColors = {
              PAGAMENTO_BANCO: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
              BAIXA: 'bg-teal-500/20 text-teal-300 border-teal-500/40',
              XML: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
              EDICAO: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
              SISTEMA: 'bg-slate-700/60 text-slate-300 border-slate-600'
            };
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-slate-900/70';
            tr.innerHTML = `
              <td class="p-3 font-mono text-[11px] text-slate-400 whitespace-nowrap">${new Date(ev.timestamp).toLocaleString('pt-BR')}</td>
              <td class="p-3"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold border ${typeColors[ev.type] || typeColors.SISTEMA}">${escapeHtml(ev.type)}</span></td>
              <td class="p-3">
                <div class="font-semibold text-white">${escapeHtml(ev.supplier)}</div>
                <div class="text-[10px] font-mono text-slate-400">NF-e: ${escapeHtml(ev.nfeNumber || '-')}</div>
              </td>
              <td class="p-3">
                ${ev.amountCents > 0 ? `<div class="font-mono font-bold text-emerald-300">${formatCurrencyBRL(ev.amountCents)}</div>` : ''}
                <div class="text-[11px] text-slate-300">${escapeHtml(ev.details)}</div>
              </td>
            `;
            tbody.appendChild(tr);
          });
        }

        // Load only file metadata via cursor (without keeping blobs in memory)
        const vaultList = document.getElementById('storageVaultFilesList');
        try {
          const list = await listArquivosMetadata();
          let totalBytes = 0;
          for (let i = 0; i < list.length; i++) totalBytes += list[i].size || 0;

          document.getElementById('storageStatFiles').textContent = String(list.length);
          const kb = (totalBytes / 1024).toFixed(1);
          document.getElementById('storageStatBytes').textContent = `${kb} KB armazenados no cofre local`;

          if (list.length === 0) {
            vaultList.innerHTML = '<div class="p-4 rounded-lg bg-slate-900/70 text-slate-400 text-center">Nenhum arquivo anexado ainda. Importe um XML, boleto ou comprovante para guardar aqui.</div>';
          } else {
            vaultList.innerHTML = list.map(item =>
              `<div class="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-2">` +
              `<div class="min-w-0"><div class="font-mono font-semibold text-slate-200 truncate" title="${escapeHtml(item.fileName)}">${escapeHtml(item.fileName)}</div><div class="text-[10px] text-slate-400 uppercase">${escapeHtml(item.kind)} • ${(item.size / 1024).toFixed(1)} KB</div></div>` +
              `<button type="button" data-vault-open="${escapeHtml(item.key)}" data-vault-name="${escapeHtml(item.fileName)}" class="px-2.5 py-1 rounded bg-indigo-600/25 hover:bg-indigo-600/40 text-indigo-200 font-semibold text-[11px] shrink-0">Abrir</button>` +
              `</div>`
            ).join('');
          }
        } catch (err) {
          vaultList.innerHTML = '<div class="p-3 text-slate-400">Cofre IndexedDB pronto para novos arquivos.</div>';
        }
      }

      // Initialize Storage & Bank Payment listeners
      loadPaymentAndStorageSettings();
      populateBankSelectors();
      document.getElementById('storageVaultFilesList').addEventListener('click', (e) => {
        const btn = e.target && e.target.closest('[data-vault-open]');
        if (btn) {
          openHistoryAttachment(btn.getAttribute('data-vault-open'), btn.getAttribute('data-vault-name') || 'arquivo');
        }
      });

      document.getElementById('btnCloseAutoPayModal').addEventListener('click', () => {
        closeModal('autoPayModalBackdrop');
      });

      document.getElementById('btnAutoPayFromPreview').addEventListener('click', () => {
        if (!state.activePreviewId) return;
        closeModal('boletoPreviewModalBackdrop');
        openAutoPayModal(state.activePreviewId);
      });

      document.getElementById('autoPayModeBoleto').addEventListener('click', () => {
        activeAutoPayMode = 'BOLETO';
        updateAutoPayCodePreview();
      });
      document.getElementById('autoPayModeNfe').addEventListener('click', () => {
        activeAutoPayMode = 'NFE';
        updateAutoPayCodePreview();
      });
      document.getElementById('autoPayModePix').addEventListener('click', () => {
        activeAutoPayMode = 'PIX';
        updateAutoPayCodePreview();
      });

      document.getElementById('btnUseCnpjAsPix').addEventListener('click', () => {
        const rec = state.records.find(r => r.id === activeAutoPayRecordId);
        if (!rec) return;
        const digits = String(rec.cnpj || '').replace(/\D/g, '');
        if (!digits || !isValidCnpj(digits)) {
          showToast('CNPJ ausente ou inválido', 'Este registro não possui um CNPJ válido. Informe a chave PIX do fornecedor manualmente.', 'warning');
          return;
        }
        document.getElementById('autoPayPixKeyInput').value = digits;
        setSavedPixKeyForRecord(rec, digits);
        savePaymentSettings();
        updateAutoPayCodePreview();
      });

      const autoPayPixInputEl = document.getElementById('autoPayPixKeyInput');
      autoPayPixInputEl.addEventListener('input', () => {
        updateAutoPayCodePreview();
      });
      const persistPixKeyForCurrentSupplier = () => {
        const rec = state.records.find(r => r.id === activeAutoPayRecordId);
        if (!rec) return;
        const normalized = normalizePixKey(autoPayPixInputEl.value);
        if (normalized !== autoPayPixInputEl.value) autoPayPixInputEl.value = normalized;
        if (getSavedPixKeyForRecord(rec) !== normalized) {
          setSavedPixKeyForRecord(rec, normalized);
          savePaymentSettings();
        }
      };
      autoPayPixInputEl.addEventListener('change', persistPixKeyForCurrentSupplier);
      autoPayPixInputEl.addEventListener('blur', persistPixKeyForCurrentSupplier);

      document.getElementById('autoPayBankSelect').addEventListener('change', (e) => {
        const customInput = document.getElementById('autoPayCustomBankUrl');
        customInput.classList.toggle('hidden', e.target.value !== 'CUSTOM');
      });

      document.getElementById('btnSetAsDefaultBankQuick').addEventListener('click', () => {
        const code = document.getElementById('autoPayBankSelect').value;
        paymentSettings.defaultBankCode = code;
        if (code === 'CUSTOM') {
          paymentSettings.customBankUrl = document.getElementById('autoPayCustomBankUrl').value.trim();
        }
        savePaymentSettings();
        populateBankSelectors();
        const bankObj = BRAZIL_BANKS.find(b => b.code === code);
        showToast('Banco padrão salvo na base', `${bankObj ? bankObj.name : code} definido como seu banco pagador.`, 'success');
      });

      document.getElementById('btnCopyAutoPayCode').addEventListener('click', () => {
        const codeText = document.getElementById('autoPayCodeValue').value.trim();
        if (!codeText) {
          showToast('Código vazio', 'Preencha ou selecione um código válido antes de copiar.', 'warning');
          return;
        }
        copyTextToClipboard(codeText, activeAutoPayMode === 'PIX' ? 'PIX Copia e Cola (Valor Travado)' : 'Código para Pagamento');
      });

      document.getElementById('btnLaunchBankPayment').addEventListener('click', () => {
        const rec = state.records.find(r => r.id === activeAutoPayRecordId);
        if (!rec) return;

        const codeText = document.getElementById('autoPayCodeValue').value.trim();
        if (activeAutoPayMode === 'BOLETO' && codeText && codeText !== rec.digitableLine) {
          rec.digitableLine = codeText;
          saveState();
          renderAll();
        }

        const bankCode = document.getElementById('autoPayBankSelect').value;
        const bankObj = BRAZIL_BANKS.find(b => b.code === bankCode) || BRAZIL_BANKS[0];
        const targetUrl = bankCode === 'CUSTOM'
          ? (document.getElementById('autoPayCustomBankUrl').value.trim() || paymentSettings.customBankUrl)
          : bankObj.url;

        if (codeText) {
          copyTextToClipboard(codeText, `${bankObj.name} (${formatCurrencyBRL(rec.amountCents)})`);
        }

        recordStorageEvent(
          'PAGAMENTO_BANCO',
          `Enviado para ${bankObj.name} via ${activeAutoPayMode} — Valor definido: ${formatCurrencyBRL(rec.amountCents)}`,
          rec
        );

        if (targetUrl) {
          window.open(targetUrl, '_blank', 'noopener,noreferrer');
          showToast(
            `🏦 Abrindo ${bankObj.name} (${formatCurrencyBRL(rec.amountCents)})`,
            `Código copiado! Cole em "${bankObj.payHint}" e depois clique em "Já Paguei — Dar Baixa".`,
            'success'
          );
        } else {
          showToast('Informe a URL do seu banco', 'Preencha o endereço do Internet Banking ou escolha um banco da lista.', 'warning');
        }
      });

      document.getElementById('btnConfirmPaidAfterBank').addEventListener('click', () => {
        const rec = state.records.find(r => r.id === activeAutoPayRecordId);
        if (!rec) return;
        closeModal('autoPayModalBackdrop');
        beginPayment(rec.id);
        const methodSel = document.getElementById('paymentMethod');
        if (methodSel) {
          methodSel.value = activeAutoPayMode === 'PIX' ? 'Pix' : 'Boleto';
        }
        const bankObj = BRAZIL_BANKS.find(b => b.code === document.getElementById('autoPayBankSelect').value);
        const noteEl = document.getElementById('paymentNote');
        if (noteEl && bankObj) {
          noteEl.value = `Pago via ${bankObj.name} (${activeAutoPayMode})`;
        }
      });

      // Storage View Controls
      document.getElementById('storageLogFilter').addEventListener('change', renderStorageBaseView);
      document.getElementById('btnRefreshStorageView').addEventListener('click', renderStorageBaseView);

      document.getElementById('storageDefaultBankSelect').addEventListener('change', (e) => {
        document.getElementById('storageCustomBankUrlInput').classList.toggle('hidden', e.target.value !== 'CUSTOM');
      });

      document.getElementById('btnSaveDefaultBank').addEventListener('click', () => {
        const code = document.getElementById('storageDefaultBankSelect').value;
        paymentSettings.defaultBankCode = code;
        paymentSettings.customBankUrl = document.getElementById('storageCustomBankUrlInput').value.trim();
        savePaymentSettings();
        populateBankSelectors();
        renderStorageBaseView();
        showToast('Banco padrão gravado', 'Sua preferência de banco foi salva na base local.', 'success');
      });

      document.getElementById('btnDownloadBackupFromStorage').addEventListener('click', () => {
        document.getElementById('btnExportDatabaseJson').click();
      });

      document.getElementById('btnExportStorageLogCsv').addEventListener('click', () => {
        const header = ['Data/Hora', 'Tipo', 'Fornecedor', 'NF-e', 'Valor (R$)', 'Detalhes'].map(csvCell).join(';');
        const lines = [header];
        storageEvents.forEach(ev => {
          lines.push([
            new Date(ev.timestamp).toLocaleString('pt-BR'),
            ev.type,
            ev.supplier || '',
            ev.nfeNumber || '-',
            (Number(ev.amountCents || 0) / 100).toFixed(2).replace('.', ','),
            ev.details || ''
          ].map(csvCell).join(';'));
        });
        const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
        downloadBlob(blob, `argon_base_registros_${state.referenceDate}.csv`);
        showToast('Log da Base exportado', 'Relatório CSV de todos os registros salvo.', 'success');
      });
    });

    // --- PWA SERVICE WORKER REGISTRATION ---
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
      });
    }
