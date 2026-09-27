document.addEventListener('DOMContentLoaded', () => {

    // ─── Toast notifications ───
    function showToast(msg, type = '', duration = 2400) {
        const container = document.getElementById('toast-container');
        const el = document.createElement('div');
        el.className = 'toast' + (type ? ' ' + type : '');
        const icons = { success: 'fa-check', error: 'fa-triangle-exclamation', '': 'fa-circle-info' };
        el.innerHTML = `<i class="fa-solid ${icons[type] || icons['']}"></i>${msg}`;
        container.appendChild(el);
        setTimeout(() => {
            el.style.animation = 'toast-out 0.28s ease forwards';
            setTimeout(() => el.remove(), 300);
        }, duration);
    }

    // ─── Copy to clipboard ───
    function copyToClipboard(text, btn) {
        navigator.clipboard.writeText(text).then(() => {
            showToast('Panoya kopyalandı', 'success');
            if (btn) {
                const orig = btn.innerHTML;
                btn.innerHTML = '<i class="fa-solid fa-check"></i> Kopyalandı';
                btn.classList.add('copied');
                setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copied'); }, 2000);
            }
        }).catch(() => showToast('Kopyalama başarısız', 'error'));
    }

    // ─── Typewriter text reveal (cancellable) ───
    let activeTypewriters = [];
    function typewriterReveal(el, text) {
        const tokens = text.split(/(\s+)/);
        const delay = Math.max(8, Math.min(38, 1600 / tokens.length));
        let i = 0;
        let cancelled = false;
        const handle = { cancel() { cancelled = true; el.textContent = text; el.classList.remove('typing-active'); } };
        activeTypewriters.push(handle);
        el.textContent = '';
        el.classList.add('typing-active');
        function step() {
            if (cancelled) return;
            if (i < tokens.length) {
                el.textContent += tokens[i++];
                setTimeout(step, delay);
            } else {
                el.classList.remove('typing-active');
            }
        }
        setTimeout(step, 60);
        return handle;
    }
    function cancelAllTypewriters() {
        activeTypewriters.forEach(h => h.cancel());
        activeTypewriters = [];
    }

    // ─── Elements ───
    const dropZone        = document.getElementById('drop-zone');
    const fileInput       = document.getElementById('file-input');
    const uploadPH        = document.getElementById('upload-placeholder');
    const imagePreview    = document.getElementById('image-preview');
    const consolePreview  = document.getElementById('console-preview');
    const removeImageBtn  = document.getElementById('remove-image');
    const compareBtn      = document.getElementById('compare-btn');
    const promptInput     = document.getElementById('prompt-input');
    const charCounter     = document.getElementById('char-counter');
    const modelGroups     = document.getElementById('model-groups');
    const resultsEmpty    = document.getElementById('results-empty');
    const progressWrap    = document.getElementById('progress-container');
    const progressText    = document.getElementById('progress-text');
    const progressCount   = document.getElementById('progress-count');
    const progressFill    = document.getElementById('progress-fill');
    const chatFeed        = document.getElementById('chat-feed');

    let currentFile    = null;
    let selectedModels = new Set();
    let isComparing    = false;
    let familiesCache  = {};

    // Session state
    const SESSIONS_KEY = 'vlm-studio-sessions';
    const MAX_SESSIONS = 60;
    const MAX_MESSAGES = 50;
    let activeSessionId    = null;
    let pendingResults     = [];
    let pendingImageDataUrl = null;
    let pendingPrompt      = '';
    let currentMsgGroupEl  = null;
    let currentResultsEl   = null;
    let currentAbort       = null;   // AbortController for active fetch
    let comparisonEpoch    = 0;      // unique ID per comparison run

    // Clear old history format
    localStorage.removeItem('vlm-studio-history');

    // ─── Families ───
    async function loadFamilies() {
        try {
            const res = await fetch('/api/families');
            familiesCache = await res.json();
            populateFamilyDropdown('custom-family');
            populateFamilyDropdown('edit-family');
            renderCustomFamiliesList();
        } catch (e) { console.error(e); }
    }

    function populateFamilyDropdown(id) {
        const sel = document.getElementById(id);
        if (!sel) return;
        const prev = sel.value;
        sel.innerHTML = '';
        for (const [key, info] of Object.entries(familiesCache)) {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = info.name;
            sel.appendChild(opt);
        }
        if (prev && sel.querySelector(`option[value="${prev}"]`)) sel.value = prev;
        if (id === 'custom-family') updateFamilyHint();
    }

    function updateFamilyHint() {
        const info = familiesCache[document.getElementById('custom-family').value];
        const hint = document.getElementById('family-desc-hint');
        if (info) {
            const r = info.requirements?.length ? ` — ${info.requirements.join(', ')}` : '';
            hint.textContent = info.description + r;
        } else hint.textContent = '';
    }
    document.getElementById('custom-family').addEventListener('change', updateFamilyHint);

    function renderCustomFamiliesList() {
        const container = document.getElementById('custom-families-list');
        const custom = Object.entries(familiesCache).filter(([, v]) => !v.builtin);
        container.innerHTML = '';
        if (!custom.length) return;
        container.innerHTML = `<p class="hint" style="margin-bottom:0.5rem;font-weight:600;color:var(--text-sec)">Kayıtlı Özel Aileler</p>`;
        custom.forEach(([key, info]) => {
            const row = document.createElement('div');
            row.className = 'family-row';
            row.innerHTML = `
                <div>
                    <div class="family-row-name">${info.name}</div>
                    <div class="family-row-meta">${info.strategy}${info.requirements?.length ? ' · ' + info.requirements.join(', ') : ''}</div>
                </div>
                <button class="action-btn del" data-key="${key}" title="Sil"><i class="fa-solid fa-trash"></i></button>`;
            row.querySelector('button').addEventListener('click', async () => {
                if (!confirm(`"${info.name}" ailesini silmek istiyor musunuz?`)) return;
                const fd = new FormData();
                fd.append('key', key);
                await fetch('/api/families/remove', { method: 'DELETE', body: fd });
                await loadFamilies();
            });
            container.appendChild(row);
        });
    }

    // ─── Models ───
    async function loadModels() {
        try {
            const res = await fetch('/api/models');
            const grouped = await res.json();
            modelGroups.innerHTML = '';

            if (!Object.keys(grouped).length) {
                modelGroups.innerHTML = '<p class="hint">Henüz model eklenmemiş.</p>';
                return;
            }

            // Flatten all groups and render only model rows (no group headings)
            const allModels = [];
            for (const models of Object.values(grouped)) { allModels.push(...models); }

            allModels.forEach(m => {
                const row = document.createElement('label');
                row.className = 'model-row' + (selectedModels.has(m.key) ? ' selected' : '');
                row.innerHTML = `
                    <input type="checkbox" value="${m.key}" ${selectedModels.has(m.key) ? 'checked' : ''}>
                    <span class="model-check"><i class="fa-solid fa-check"></i></span>
                    <span class="model-name">${m.name}</span>
                    <div class="model-actions">
                        <button class="action-btn edit-btn" title="Düzenle" onclick="event.preventDefault()">
                            <i class="fa-solid fa-pen"></i>
                        </button>
                        <button class="action-btn del del-btn" title="Sil" onclick="event.preventDefault()">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>`;

                const cb = row.querySelector('input');
                cb.addEventListener('change', () => {
                    if (cb.checked) { selectedModels.add(m.key); row.classList.add('selected'); }
                    else { selectedModels.delete(m.key); row.classList.remove('selected'); }
                    updateCompareBtn();
                });

                row.querySelector('.edit-btn').addEventListener('click', (e) => {
                    e.preventDefault(); e.stopPropagation();
                    openEditModal(m.key, m.name);
                });

                row.querySelector('.del-btn').addEventListener('click', async (e) => {
                    e.preventDefault(); e.stopPropagation();
                    if (!confirm(`"${m.name}" modelini kaldırmak istiyor musunuz?`)) return;
                    const fd = new FormData();
                    fd.append('key', m.key);
                    await fetch('/api/models/remove', { method: 'DELETE', body: fd });
                    selectedModels.delete(m.key);
                    updateCompareBtn();
                    await loadModels();
                });

                modelGroups.appendChild(row);
            });
        } catch (e) {
            modelGroups.innerHTML = '<p style="color:var(--red);font-size:0.8rem">Model listesi yüklenemedi.</p>';
        }
    }

    loadFamilies();
    loadModels();

    // ─── Edit Modal ───
    function openEditModal(key, name) {
        const models = getModelsFlat();
        const m = models.find(x => x.key === key);
        if (!m) return;

        document.getElementById('edit-key').value = key;
        document.getElementById('edit-name').value = m.name;
        document.getElementById('edit-path').value = m.path || '';

        populateFamilyDropdown('edit-family');
        const editFamilySel = document.getElementById('edit-family');
        if (m.family && editFamilySel.querySelector(`option[value="${m.family}"]`)) {
            editFamilySel.value = m.family;
        }

        document.getElementById('edit-status').textContent = '';
        document.getElementById('edit-status').style.color = '';
        document.getElementById('edit-modal-overlay').classList.remove('hidden');
        document.getElementById('edit-name').focus();
    }

    let modelsFlat = [];
    function getModelsFlat() { return modelsFlat; }

    async function refreshModelsFlat() {
        try {
            const res = await fetch('/api/models');
            const grouped = await res.json();
            modelsFlat = [];
            for (const [, models] of Object.entries(grouped)) {
                models.forEach(m => modelsFlat.push(m));
            }
        } catch (e) {}
    }
    refreshModelsFlat();

    const origLoadModels = loadModels;
    async function loadModelsAndRefresh() {
        await origLoadModels.apply(this, arguments);
        await refreshModelsFlat();
    }

    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('edit-modal-overlay').addEventListener('click', (e) => {
        if (e.target === document.getElementById('edit-modal-overlay')) closeModal();
    });

    function closeModal() {
        document.getElementById('edit-modal-overlay').classList.add('hidden');
    }

    document.getElementById('modal-save').addEventListener('click', async () => {
        const key    = document.getElementById('edit-key').value;
        const name   = document.getElementById('edit-name').value.trim();
        const path   = document.getElementById('edit-path').value.trim();
        const family = document.getElementById('edit-family').value;
        const status = document.getElementById('edit-status');

        if (!name || !path) {
            status.textContent = 'İsim ve yol boş bırakılamaz.';
            status.style.color = 'var(--yellow)';
            return;
        }

        const saveBtn = document.getElementById('modal-save');
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Kaydediliyor...';

        const fd = new FormData();
        fd.append('key', key);
        fd.append('name', name);
        fd.append('path', path);
        fd.append('family', family);

        try {
            const res = await fetch('/api/models/update', { method: 'PUT', body: fd });
            const data = await res.json();
            if (data.status === 'success') {
                closeModal();
                await loadModels();
                await refreshModelsFlat();
            } else {
                status.textContent = 'Hata: ' + data.message;
                status.style.color = 'var(--red)';
            }
        } catch (e) {
            status.textContent = 'Bağlantı hatası.';
            status.style.color = 'var(--red)';
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Kaydet';
        }
    });

    // ─── Upload ───
    function updateCompareBtn() {
        compareBtn.disabled = !(currentFile && selectedModels.size > 0 && !isComparing);
    }

    function updateCharCounter() {
        if (charCounter) {
            const length = promptInput.value.length;
            charCounter.textContent = `${length}/30`;
        }
    }

    function enforcePromptLimit(el) {
        if (el && el.value.length > 30) {
            el.value = el.value.slice(0, 30);
        }
        updateCharCounter();
    }

    promptInput.addEventListener('input', () => enforcePromptLimit(promptInput));
    updateCharCounter();

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev =>
        dropZone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }));
    ['dragenter', 'dragover'].forEach(ev =>
        dropZone.addEventListener(ev, () => dropZone.classList.add('dragover')));
    ['dragleave', 'drop'].forEach(ev =>
        dropZone.addEventListener(ev, () => dropZone.classList.remove('dragover')));

    dropZone.addEventListener('drop', e => handleFiles(e.dataTransfer.files));
    dropZone.addEventListener('click', () => { if (!currentFile) fileInput.click(); });
    fileInput.addEventListener('change', function () { handleFiles(this.files); });

    function handleFiles(files) {
        if (files.length > 0 && files[0].type.startsWith('image/')) {
            currentFile = files[0];
            const reader = new FileReader();
            reader.readAsDataURL(files[0]);
            reader.onloadend = () => {
                imagePreview.src = reader.result;
                consolePreview.classList.remove('hidden');
                uploadPH.classList.add('hidden');
                imagePreview.classList.remove('hidden');
                removeImageBtn.classList.remove('hidden');
                updateCompareBtn();
            };
        }
    }

    removeImageBtn.addEventListener('click', e => {
        e.stopPropagation();
        currentFile = null;
        fileInput.value = '';
        imagePreview.src = '';
        uploadPH.classList.remove('hidden');
        consolePreview.classList.add('hidden');
        imagePreview.classList.add('hidden');
        removeImageBtn.classList.add('hidden');
        updateCompareBtn();
    });

    function appendUserBubble(imageSrc, promptText, modelNames) {
        const msgGroup = document.createElement('div');
        msgGroup.className = 'chat-message-group';
        msgGroup.innerHTML = `
            <div class="user-input-bubble">
                <img class="chat-user-image" src="${imageSrc}" alt="Görsel">
                <div class="chat-user-content">
                    <span class="chat-user-prompt">${promptText}</span>
                    <span class="chat-user-models">${modelNames.join(', ')}</span>
                </div>
            </div>
            <div class="chat-model-results"></div>`;
        chatFeed.appendChild(msgGroup);
        const img = msgGroup.querySelector('.chat-user-image');
        img.addEventListener('click', () => {
            openLightbox(imageSrc);
        });
        msgGroup.scrollIntoView({ behavior: 'smooth', block: 'end' });
        return msgGroup;
    }

    // ─── Compare ───
    compareBtn.addEventListener('click', runComparison);

    function finalizeOldLoadingCards() {
        // Remove any lingering loading cards from previous runs
        chatFeed.querySelectorAll('.result-card.loading').forEach(card => card.remove());
    }

    async function runComparison() {
        if (!currentFile || selectedModels.size === 0) return;

        // ── Abort previous comparison if still running ──
        if (currentAbort) {
            currentAbort.abort();
            currentAbort = null;
        }
        cancelAllTypewriters();
        finalizeOldLoadingCards();

        isComparing = true;
        comparisonEpoch++;
        const myEpoch = comparisonEpoch;
        pendingResults = [];
        pendingImageDataUrl = imagePreview.src || null;
        pendingPrompt = promptInput.value.slice(0, 30).trim();
        compareBtn.disabled = true;
        compareBtn.querySelector('span').textContent = 'İşleniyor...';
        compareBtn.querySelector('i').className = 'fa-solid fa-spinner fa-spin';

        // Auto-create session if none active
        if (!activeSessionId) {
            activeSessionId = Date.now().toString(36) + Math.random().toString(36).slice(2);
        }

        resultsEmpty.classList.add('hidden');
        if (progressWrap) progressWrap.classList.remove('hidden');
        if (progressFill) progressFill.style.width = '0%';

        const modelNames = Array.from(selectedModels);
        const promptDisplay = pendingPrompt || 'Görüntüyü açıkla';
        const msgGroup = appendUserBubble(pendingImageDataUrl, promptDisplay, modelNames);
        currentMsgGroupEl = msgGroup;
        currentResultsEl = msgGroup.querySelector('.chat-model-results');

        msgGroup.scrollIntoView({ behavior: 'smooth', block: 'end' });

        const fd = new FormData();
        fd.append('image', currentFile);
        fd.append('models', JSON.stringify(Array.from(selectedModels)));
        if (pendingPrompt) fd.append('prompt', pendingPrompt);

        const abortCtrl = new AbortController();
        currentAbort = abortCtrl;

        try {
            const response = await fetch('/api/compare', { method: 'POST', body: fd, signal: abortCtrl.signal });
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done || myEpoch !== comparisonEpoch) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();
                for (const line of lines) {
                    if (myEpoch !== comparisonEpoch) break;
                    if (line.startsWith('data: ')) {
                        try { handleSSE(JSON.parse(line.slice(6)), myEpoch); } catch (_) {}
                    }
                }
            }
        } catch (err) {
            if (err.name === 'AbortError') return; // intentional abort, don't show error
            if (myEpoch !== comparisonEpoch) return; // stale
            currentResultsEl.innerHTML += `
                <div class="result-card error">
                    <div class="result-card-header">
                        <div class="result-model-name"><i class="fa-solid fa-triangle-exclamation" style="color:var(--red)"></i> Bağlantı Hatası</div>
                    </div>
                    <div class="result-body"><div class="result-caption">${err.message}</div></div>
                </div>`;
        } finally {
            if (myEpoch === comparisonEpoch) {
                isComparing = false;
                currentAbort = null;
                compareBtn.querySelector('span').textContent = 'Analizi Başlat';
                compareBtn.querySelector('i').className = 'fa-solid fa-play';
                updateCompareBtn();
            }
        }
    }

    function handleSSE(data, epoch) {
        if (epoch !== comparisonEpoch) return; // stale event, ignore
        const cardId = `card-${epoch}-${data.index}`;

        if (data.type === 'loading') {
            if (progressText) progressText.textContent = `Yükleniyor: ${data.model_name}`;
            if (progressCount) progressCount.textContent = `${data.index + 1} / ${data.total}`;

            const card = document.createElement('div');
            card.className = 'result-card loading';
            card.id = cardId;
            card.style.animationDelay = `${data.index * 0.06}s`;
            card.innerHTML = `
                <div class="result-card-header">
                    <div class="result-model-name">
                        <div class="model-status-dot loading"></div>
                        ${data.model_name}
                    </div>
                </div>
                <div class="result-body">
                    <div class="typing-indicator">
                        <div class="typing-dots"><span></span><span></span><span></span></div>
                        <span class="typing-label">Model yükleniyor ve çıktı üretiliyor...</span>
                    </div>
                </div>`;
            currentResultsEl.appendChild(card);
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        } else if (data.type === 'result') {
            if (epoch !== comparisonEpoch) return;
            const pct = ((data.index + 1) / data.total * 100).toFixed(0);
            if (progressFill) progressFill.style.width = pct + '%';
            if (progressText) progressText.textContent = `Tamamlandı: ${data.model_name}`;
            if (progressCount) progressCount.textContent = `${data.index + 1} / ${data.total}`;

            const card = document.getElementById(cardId);
            if (card) {
                const wordCount = data.caption.trim().split(/\s+/).filter(Boolean).length;
                card.className = 'result-card success';
                card.innerHTML = `
                    <div class="result-card-header">
                        <div class="result-model-name">
                            <div class="model-status-dot done"></div>
                            ${data.model_name}
                            <span class="model-badge">${data.model_key.split('/').pop()}</span>
                        </div>
                        <div class="result-meta-right">
                            <span class="word-count-badge">${wordCount} kelime</span>
                            <div class="result-times">
                                <span><i class="fa-solid fa-download"></i> ${data.load_time}s</span>
                                <span><i class="fa-solid fa-bolt"></i> ${data.infer_time}s</span>
                            </div>
                        </div>
                    </div>
                    <div class="result-body">
                        <div class="result-caption"></div>
                        <div class="result-actions">
                            <button class="copy-btn" title="Metni kopyala">
                                <i class="fa-regular fa-copy"></i> Kopyala
                            </button>
                        </div>
                    </div>`;
                typewriterReveal(card.querySelector('.result-caption'), data.caption);
                card.querySelector('.copy-btn').addEventListener('click', function () {
                    copyToClipboard(data.caption, this);
                });
            }
            pendingResults.push({ type: 'result', index: data.index, model_key: data.model_key, model_name: data.model_name, caption: data.caption, load_time: data.load_time, infer_time: data.infer_time });

        } else if (data.type === 'error') {
            if (epoch !== comparisonEpoch) return;
            const card = document.getElementById(cardId);
            if (card) {
                card.className = 'result-card error';
                card.innerHTML = `
                    <div class="result-card-header">
                        <div class="result-model-name">
                            <div class="model-status-dot error"></div>
                            ${data.model_name}
                        </div>
                    </div>
                    <div class="result-body"><div class="result-caption">${data.error}</div></div>`;
            }
            pendingResults.push({ type: 'error', index: data.index, model_key: data.model_key || '', model_name: data.model_name, error: data.error });

        } else if (data.type === 'done') {
            if (epoch !== comparisonEpoch) return;
            if (progressText) progressText.textContent = 'Tüm modeller tamamlandı';
            if (progressFill) progressFill.style.width = '100%';
            if (pendingImageDataUrl && pendingResults.length > 0) {
                createThumbnail(pendingImageDataUrl).then(thumb => {
                    saveSessionMessage(thumb);
                });
            }
        }
    }

    function saveSessionMessage(thumb) {
        const sessions = getSessions();
        let session = sessions.find(s => s.id === activeSessionId);
        const isNew = !session;
        if (isNew) {
            session = {
                id: activeSessionId,
                title: (pendingPrompt || pendingResults[0]?.model_name || 'Yeni Sohbet').slice(0, 60),
                createdAt: Date.now(),
                thumb: thumb,
                messages: []
            };
        }
        // Add user message
        session.messages.push({
            role: 'user',
            imageDataUrl: thumb,
            prompt: pendingPrompt,
            selectedModels: Array.from(selectedModels),
            timestamp: Date.now()
        });
        // Add system message
        session.messages.push({
            role: 'system',
            results: pendingResults.slice(),
            timestamp: Date.now()
        });
        // Enforce message limit
        if (session.messages.length > MAX_MESSAGES) {
            session.messages = session.messages.slice(-MAX_MESSAGES);
        }
        // Update thumb to latest
        session.thumb = thumb;

        if (isNew) {
            sessions.unshift(session);
            if (sessions.length > MAX_SESSIONS) sessions.length = MAX_SESSIONS;
        }
        saveSessionsStore(sessions);
        renderHistory(histSearch.value.trim().toLowerCase());
        // Highlight active
        document.querySelectorAll('.history-item').forEach(el =>
            el.classList.toggle('active', el.dataset.id === activeSessionId));
        // Update header
        document.getElementById('page-title').textContent = session.title;
        document.getElementById('page-sub').textContent = `${session.messages.filter(m => m.role === 'user').length} mesaj`;
    }

    // ─── Management Drawer ───
    const drawerOverlay = document.getElementById('drawer-overlay');
    const drawer = document.getElementById('management-drawer');
    const drawerModelList = document.getElementById('drawer-model-list');

    function openDrawer() {
        drawerOverlay.classList.remove('hidden');
        requestAnimationFrame(() => drawerOverlay.classList.add('visible'));
        drawer.classList.add('open');
        loadDrawerModels();
    }
    function closeDrawer() {
        drawerOverlay.classList.remove('visible');
        drawer.classList.remove('open');
        setTimeout(() => drawerOverlay.classList.add('hidden'), 320);
    }

    const openMgmtBtn = document.getElementById('open-management-btn');
    if (openMgmtBtn) openMgmtBtn.addEventListener('click', openDrawer);
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) settingsBtn.addEventListener('click', openDrawer);
    document.getElementById('close-drawer-btn').addEventListener('click', closeDrawer);
    drawerOverlay.addEventListener('click', closeDrawer);

    async function loadDrawerModels() {
        try {
            const res = await fetch('/api/models');
            const grouped = await res.json();
            drawerModelList.innerHTML = '';
            if (!Object.keys(grouped).length) {
                drawerModelList.innerHTML = '<p class="hint">Henüz model eklenmemiş.</p>';
                return;
            }
            for (const [groupName, models] of Object.entries(grouped)) {
                const titleEl = document.createElement('div');
                titleEl.className = 'model-group-title';
                titleEl.textContent = groupName;
                drawerModelList.appendChild(titleEl);
                models.forEach(m => {
                    const row = document.createElement('div');
                    row.className = 'model-row';
                    row.innerHTML = `
                        <span class="model-name">${m.name}</span>
                        <div class="model-actions">
                            <button class="action-btn edit-btn" title="Düzenle"><i class="fa-solid fa-pen"></i></button>
                            <button class="action-btn del del-btn" title="Sil"><i class="fa-solid fa-trash"></i></button>
                        </div>`;
                    row.querySelector('.edit-btn').addEventListener('click', () => openEditModal(m.key, m.name));
                    row.querySelector('.del-btn').addEventListener('click', async () => {
                        if (!confirm(`"${m.name}" modelini kaldırmak istiyor musunuz?`)) return;
                        const fd = new FormData(); fd.append('key', m.key);
                        await fetch('/api/models/remove', { method: 'DELETE', body: fd });
                        selectedModels.delete(m.key);
                        updateCompareBtn();
                        await loadModels();
                        await refreshModelsFlat();
                        loadDrawerModels();
                    });
                    drawerModelList.appendChild(row);
                });
            }
        } catch (e) {
            drawerModelList.innerHTML = '<p style="color:var(--red);font-size:0.8rem">Model listesi yüklenemedi.</p>';
        }
    }

    // ─── Add Model ───
    document.getElementById('add-model-btn').addEventListener('click', async () => {
        const name   = document.getElementById('custom-name').value.trim();
        const path   = document.getElementById('custom-path').value.trim();
        const family = document.getElementById('custom-family').value;
        const status = document.getElementById('add-model-status');

        if (!name || !path) {
            status.textContent = 'Lütfen isim ve yol girin.';
            status.style.color = 'var(--yellow)';
            return;
        }

        const btn = document.getElementById('add-model-btn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Ekleniyor...';
        status.textContent = '';

        const fd = new FormData();
        fd.append('name', name); fd.append('path', path); fd.append('family', family);

        try {
            const res = await fetch('/api/models/add', { method: 'POST', body: fd });
            const data = await res.json();
            if (data.status === 'success') {
                status.textContent = 'Model eklendi!';
                status.style.color = 'var(--green)';
                document.getElementById('custom-name').value = '';
                document.getElementById('custom-path').value = '';
                await loadModels();
                await refreshModelsFlat();
                loadDrawerModels();
            } else {
                status.textContent = 'Hata: ' + data.message;
                status.style.color = 'var(--red)';
            }
        } catch (e) {
            status.textContent = 'Bağlantı hatası.';
            status.style.color = 'var(--red)';
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-plus"></i> Kütüphaneye Ekle';
        }
    });

    // ─── Add Family ───
    document.getElementById('add-family-btn').addEventListener('click', async () => {
        const name     = document.getElementById('family-name').value.trim();
        const desc     = document.getElementById('family-description').value.trim();
        const strategy = document.getElementById('family-strategy').value;
        const reqs     = document.getElementById('family-requirements').value.trim();
        const status   = document.getElementById('add-family-status');

        if (!name) {
            status.textContent = 'Lütfen aile adı girin.';
            status.style.color = 'var(--yellow)';
            return;
        }

        const btn = document.getElementById('add-family-btn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Kaydediliyor...';

        const fd = new FormData();
        fd.append('name', name); fd.append('description', desc);
        fd.append('strategy', strategy); fd.append('requirements', reqs);

        try {
            const res = await fetch('/api/families/add', { method: 'POST', body: fd });
            const data = await res.json();
            if (data.status === 'success') {
                status.textContent = `"${name}" eklendi!`;
                status.style.color = 'var(--green)';
                document.getElementById('family-name').value = '';
                document.getElementById('family-description').value = '';
                document.getElementById('family-requirements').value = '';
                await loadFamilies();
            } else {
                status.textContent = 'Hata: ' + data.message;
                status.style.color = 'var(--red)';
            }
        } catch (e) {
            status.textContent = 'Bağlantı hatası.';
            status.style.color = 'var(--red)';
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Kaydet';
        }
    });

    // ─── Keyboard shortcuts ───
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') { closeModal(); closeDrawer(); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            if (!compareBtn.disabled) compareBtn.click();
            else if (!landingCompareBtn.disabled) landingCompareBtn.click();
        }
    });

    // ─── Fade-Rotate Subtitle Effect ───
    const subtitlePhrases = [
        'Farklı VLM mimarilerini tek görselle değerlendirin',
        'Yükleme süresi, çıktı kalitesi — her şeyi kıyaslayın',
        'Düşük VRAM ile yüksek performanslı karşılaştırma',
        'Uzaktan algılama görsellerinizi akıllıca analiz edin'
    ];
    const subtitleEl = document.getElementById('landing-subtitle');
    let stIdx = 0;

    function showSubtitle() {
        subtitleEl.classList.remove('fade-in');
        subtitleEl.classList.add('fade-out');
        setTimeout(() => {
            subtitleEl.textContent = subtitlePhrases[stIdx];
            subtitleEl.classList.remove('fade-out');
            subtitleEl.classList.add('fade-in');
            stIdx = (stIdx + 1) % subtitlePhrases.length;
        }, 450);
    }
    // Initial show
    subtitleEl.textContent = subtitlePhrases[0];
    subtitleEl.classList.add('fade-in');
    stIdx = 1;
    setInterval(showSubtitle, 4000);

    // ─── Landing Screen ───
    const landingScreen      = document.getElementById('landing-screen');
    const landingDrop        = document.getElementById('landing-drop-zone');
    const landingInput       = document.getElementById('landing-file-input');
    const landingUploadInner = document.getElementById('landing-upload-inner');
    const landingPreview     = document.getElementById('landing-preview');
    const landingRemoveImg   = document.getElementById('landing-remove-img');
    const landingChips       = document.getElementById('landing-model-chips');
    const landingPrompt      = document.getElementById('landing-prompt');
    const landingCompareBtn  = document.getElementById('landing-compare-btn');
    const appShell           = document.getElementById('app-shell');

    landingPrompt.addEventListener('input', () => enforcePromptLimit(landingPrompt));

    function updateLandingCompareBtn() {
        landingCompareBtn.disabled = !(currentFile && selectedModels.size > 0);
    }

    function setLandingFile(file) {
        handleFiles([file]);
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onloadend = () => {
            landingPreview.src = reader.result;
            landingUploadInner.classList.add('hidden');
            landingPreview.classList.remove('hidden');
            landingRemoveImg.classList.remove('hidden');
            landingDrop.classList.add('has-preview');
            updateLandingCompareBtn();
        };
    }

    function clearLandingFile() {
        currentFile = null;
        fileInput.value = '';
        landingInput.value = '';
        landingPreview.src = '';
        landingUploadInner.classList.remove('hidden');
        landingPreview.classList.add('hidden');
        landingRemoveImg.classList.add('hidden');
        landingDrop.classList.remove('has-preview');
        imagePreview.src = '';
        uploadPH.classList.remove('hidden');
        imagePreview.classList.add('hidden');
        removeImageBtn.classList.add('hidden');
        updateLandingCompareBtn();
        updateCompareBtn();
    }

    function exitLanding() {
        landingScreen.classList.add('exit');
        appShell.classList.add('visible');
        setTimeout(() => { landingScreen.style.display = 'none'; }, 480);
    }

    function showLanding() {
        landingScreen.style.display = '';
        requestAnimationFrame(() => {
            landingScreen.classList.remove('exit');
            appShell.classList.remove('visible');
        });
        clearLandingFile();
        selectedModels.clear();
        document.querySelectorAll('.landing-chip').forEach(c => c.classList.remove('selected'));
        document.querySelectorAll('.model-row').forEach(r => { r.classList.remove('selected'); r.querySelector('input').checked = false; });
        landingPrompt.value = '';
        promptInput.value = '';
        updateCharCounter();
        chatFeed.innerHTML = '';
        resultsEmpty.classList.remove('hidden');
        if (progressWrap) progressWrap.classList.add('hidden');
        activeSessionId = null;
        document.querySelectorAll('.history-item').forEach(el => el.classList.remove('active'));
        updateCompareBtn();
    }

    async function loadLandingModels() {
        try {
            const res = await fetch('/api/models');
            const grouped = await res.json();
            landingChips.innerHTML = '';
            if (!Object.keys(grouped).length) {
                landingChips.innerHTML = '<span class="landing-no-models">Henüz model eklenmemiş.</span>';
                return;
            }
            for (const [, models] of Object.entries(grouped)) {
                models.forEach(m => {
                    const chip = document.createElement('div');
                    chip.className = 'landing-chip';
                    chip.dataset.key = m.key;
                    chip.innerHTML = `<span class="chip-check"><i class="fa-solid fa-check"></i></span>${m.name}`;
                    chip.addEventListener('click', () => {
                        const active = chip.classList.toggle('selected');
                        if (active) selectedModels.add(m.key);
                        else        selectedModels.delete(m.key);
                        const cb = document.querySelector(`input[value="${m.key}"]`);
                        if (cb) { cb.checked = active; cb.closest('.model-row').classList.toggle('selected', active); }
                        updateLandingCompareBtn();
                        updateCompareBtn();
                    });
                    landingChips.appendChild(chip);
                });
            }
        } catch(e) {
            landingChips.innerHTML = '<span class="landing-no-models">Modeller yüklenemedi.</span>';
        }
    }
    loadLandingModels();

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev =>
        landingDrop.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }));
    ['dragenter', 'dragover'].forEach(ev =>
        landingDrop.addEventListener(ev, () => landingDrop.classList.add('dragover')));
    ['dragleave', 'drop'].forEach(ev =>
        landingDrop.addEventListener(ev, () => landingDrop.classList.remove('dragover')));
    landingDrop.addEventListener('drop', e => { const f = e.dataTransfer.files; if (f.length > 0) setLandingFile(f[0]); });
    landingDrop.addEventListener('click', () => { if (!currentFile) landingInput.click(); });
    landingInput.addEventListener('change', function () { if (this.files.length > 0) setLandingFile(this.files[0]); });
    landingRemoveImg.addEventListener('click', e => { e.stopPropagation(); clearLandingFile(); });

    // ─── Fullscreen Lightbox ───
    function openLightbox(src) {
        const overlay = document.createElement('div');
        overlay.className = 'fullscreen-preview';
        overlay.innerHTML = `
            <span class="lightbox-close-hint"><i class="fa-solid fa-xmark"></i> Kapat</span>
            <img src="${src}" alt="Önizleme">`;
        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';

        function closeLightbox() {
            overlay.classList.add('closing');
            document.body.style.overflow = '';
            setTimeout(() => overlay.remove(), 260);
        }

        overlay.addEventListener('click', closeLightbox);
        const escHandler = (e) => {
            if (e.key === 'Escape') { closeLightbox(); document.removeEventListener('keydown', escHandler); }
        };
        document.addEventListener('keydown', escHandler);
    }

    landingPreview.addEventListener('click', (e) => {
        e.stopPropagation();
        if (landingPreview.src) openLightbox(landingPreview.src);
    });

    landingCompareBtn.addEventListener('click', () => {
        if (!currentFile || selectedModels.size === 0) return;
        landingPrompt.value = landingPrompt.value.slice(0, 30);
        promptInput.value = landingPrompt.value.trim();
        updateCharCounter();
        exitLanding();
        setTimeout(() => runComparison(), 180);
    });

    // ─── Session Management ───
    const histSidebar    = document.getElementById('history-sidebar');
    const histList       = document.getElementById('history-list');
    const histSearch     = document.getElementById('history-search');
    const histCollapseBtn = document.getElementById('history-collapse-btn');
    const histExpandBtn  = document.getElementById('history-expand-btn');
    const histHomeBtn    = document.getElementById('history-home-btn');
    const histNewChatBtn = document.getElementById('history-new-chat-btn');
    const histClearBtn   = document.getElementById('history-clear-btn');

    function getSessions() {
        try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]'); }
        catch { return []; }
    }

    function saveSessionsStore(items) {
        try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(items)); }
        catch(e) {
            const half = items.slice(0, Math.floor(items.length / 2));
            try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(half)); } catch(_) {}
        }
    }

    function deleteSession(id) {
        const sessions = getSessions().filter(s => s.id !== id);
        saveSessionsStore(sessions);
        if (activeSessionId === id) {
            activeSessionId = null;
            chatFeed.innerHTML = '';
            resultsEmpty.classList.remove('hidden');
            document.getElementById('page-title').textContent = 'Sonuçlar';
            document.getElementById('page-sub').textContent = 'Sohbet başlatın veya geçmişten seçin';
        }
        renderHistory(histSearch.value.trim().toLowerCase());
    }

    function getDateLabel(ts) {
        const now = new Date(), d = new Date(ts);
        const diff = now - d;
        const DAY = 86400000;
        if (diff < DAY && d.getDate() === now.getDate()) return 'Bugün';
        if (diff < 2 * DAY) return 'Dün';
        if (diff < 7 * DAY) return 'Bu Hafta';
        if (diff < 30 * DAY) return 'Bu Ay';
        return 'Daha Önce';
    }

    function formatRelTime(ts) {
        const diff = Date.now() - ts;
        const m = Math.floor(diff / 60000);
        if (m < 1) return 'Az önce';
        if (m < 60) return `${m} dk önce`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h} sa önce`;
        const day = Math.floor(h / 24);
        return `${day} gün önce`;
    }

    function buildResultCard(result, index) {
        const card = document.createElement('div');
        card.style.animationDelay = `${index * 0.05}s`;
        if (result.type === 'error') {
            card.className = 'result-card error';
            card.innerHTML = `
                <div class="result-card-header">
                    <div class="result-model-name"><div class="model-status-dot error"></div>${result.model_name}</div>
                </div>
                <div class="result-body"><div class="result-caption">${result.error}</div></div>`;
        } else {
            const wordCount = (result.caption || '').trim().split(/\s+/).filter(Boolean).length;
            card.className = 'result-card success';
            card.innerHTML = `
                <div class="result-card-header">
                    <div class="result-model-name">
                        <div class="model-status-dot done"></div>
                        ${result.model_name}
                        <span class="model-badge">${(result.model_key || '').split('/').pop()}</span>
                    </div>
                    <div class="result-meta-right">
                        <span class="word-count-badge">${wordCount} kelime</span>
                        <div class="result-times">
                            <span><i class="fa-solid fa-download"></i> ${result.load_time}s</span>
                            <span><i class="fa-solid fa-bolt"></i> ${result.infer_time}s</span>
                        </div>
                    </div>
                </div>
                <div class="result-body">
                    <div class="result-caption">${result.caption}</div>
                    <div class="result-actions">
                        <button class="copy-btn" title="Metni kopyala">
                            <i class="fa-regular fa-copy"></i> Kopyala
                        </button>
                    </div>
                </div>`;
            card.querySelector('.copy-btn').addEventListener('click', function () {
                copyToClipboard(result.caption, this);
            });
        }
        return card;
    }

    function renderChatFeed(session) {
        chatFeed.innerHTML = '';
        const messages = session.messages;
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            if (msg.role === 'user') {
                const group = document.createElement('div');
                group.className = 'chat-message-group';
                const promptDisplay = msg.prompt || 'Görüntüyü açıkla';
                group.innerHTML = `
                    <div class="chat-user-bubble">
                        <img class="chat-user-image" src="${msg.imageDataUrl}" alt="Görsel">
                        <div class="chat-user-content">
                            <span class="chat-user-prompt">${promptDisplay}</span>
                            <span class="chat-user-models"><i class="fa-solid fa-layer-group"></i> ${(msg.selectedModels || []).join(', ')}</span>
                        </div>
                    </div>
                    <div class="chat-model-results"></div>`;
                // Lightbox
                group.querySelector('.chat-user-image').addEventListener('click', () => {
                    openLightbox(msg.imageDataUrl);
                });
                // System results follow immediately
                const sysMsg = messages[i + 1];
                if (sysMsg && sysMsg.role === 'system') {
                    const resultsDiv = group.querySelector('.chat-model-results');
                    sysMsg.results.forEach((r, idx) => resultsDiv.appendChild(buildResultCard(r, idx)));
                    i++; // Skip system message
                }
                chatFeed.appendChild(group);
            }
        }
    }

    function loadSession(session) {
        exitLanding();
        activeSessionId = session.id;
        document.querySelectorAll('.history-item').forEach(el =>
            el.classList.toggle('active', el.dataset.id === session.id));

        document.getElementById('page-title').textContent = session.title;
        const userMsgCount = session.messages.filter(m => m.role === 'user').length;
        document.getElementById('page-sub').textContent = `${userMsgCount} mesaj · ${formatRelTime(session.createdAt)}`;

        if (progressWrap) progressWrap.classList.add('hidden');
        resultsEmpty.classList.add('hidden');
        renderChatFeed(session);
    }

    function startNewSession() {
        activeSessionId = null;
        chatFeed.innerHTML = '';
        resultsEmpty.classList.remove('hidden');
        if (progressWrap) progressWrap.classList.add('hidden');
        document.getElementById('page-title').textContent = 'Sonuçlar';
        document.getElementById('page-sub').textContent = 'Sohbet başlatın veya geçmişten seçin';
        document.querySelectorAll('.history-item').forEach(el => el.classList.remove('active'));
    }

    function renderHistoryItem(session) {
        const el = document.createElement('div');
        el.className = 'history-item' + (session.id === activeSessionId ? ' active' : '');
        el.dataset.id = session.id;
        const userMsgs = session.messages.filter(m => m.role === 'user').length;
        const meta = `${userMsgs} mesaj · ${formatRelTime(session.createdAt)}`;
        el.innerHTML = `
            <div class="history-thumb"><img src="${session.thumb}" alt=""></div>
            <div class="history-item-info">
                <div class="history-item-title">${session.title}</div>
                <div class="history-item-meta">${meta}</div>
            </div>
            <button class="history-item-del" title="Sil"><i class="fa-solid fa-trash"></i></button>`;
        el.addEventListener('click', e => {
            if (e.target.closest('.history-item-del')) return;
            loadSession(session);
        });
        el.querySelector('.history-item-del').addEventListener('click', e => {
            e.stopPropagation();
            deleteSession(session.id);
        });
        return el;
    }

    function renderHistory(query = '') {
        const all = getSessions();
        const items = query
            ? all.filter(s => (s.title || '').toLowerCase().includes(query))
            : all;

        histList.innerHTML = '';
        if (!items.length) {
            histList.innerHTML = `<div class="history-empty-state">
                <i class="fa-regular fa-clock"></i>
                <span>${query ? 'Eşleşme bulunamadı' : 'Henüz sohbet yok'}</span>
            </div>`;
            return;
        }
        const groups = {};
        items.forEach(s => {
            const label = getDateLabel(s.createdAt);
            if (!groups[label]) groups[label] = [];
            groups[label].push(s);
        });
        const ORDER = ['Bugün', 'Dün', 'Bu Hafta', 'Bu Ay', 'Daha Önce'];
        ORDER.filter(k => groups[k]).forEach(label => {
            const g = document.createElement('div');
            g.innerHTML = `<div class="history-group-label">${label}</div>`;
            groups[label].forEach(s => g.appendChild(renderHistoryItem(s)));
            histList.appendChild(g);
        });
    }

    function createThumbnail(dataUrl, maxSize = 160) {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                const ratio = Math.min(maxSize / img.width, maxSize / img.height, 1);
                const c = document.createElement('canvas');
                c.width = Math.round(img.width * ratio);
                c.height = Math.round(img.height * ratio);
                c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                resolve(c.toDataURL('image/jpeg', 0.75));
            };
            img.onerror = () => resolve(dataUrl);
            img.src = dataUrl;
        });
    }

    // Sidebar toggle
    histCollapseBtn.addEventListener('click', () => histSidebar.classList.add('collapsed'));
    histExpandBtn.addEventListener('click',   () => histSidebar.classList.remove('collapsed'));

    // Home button → landing
    histHomeBtn.addEventListener('click', showLanding);

    // New chat button
    histNewChatBtn.addEventListener('click', () => {
        exitLanding();
        startNewSession();
    });

    histClearBtn.addEventListener('click', () => {
        if (!confirm('Tüm geçmiş silinecek. Emin misiniz?')) return;
        saveSessionsStore([]);
        renderHistory();
        activeSessionId = null;
        chatFeed.innerHTML = '';
        resultsEmpty.classList.remove('hidden');
        document.getElementById('page-title').textContent = 'Sonuçlar';
        document.getElementById('page-sub').textContent = 'Sohbet başlatın veya geçmişten seçin';
    });

    histSearch.addEventListener('input', () => renderHistory(histSearch.value.trim().toLowerCase()));

    renderHistory();
});
