
    (function(){
        // ---------- DOM 元素 ----------
        const searchInput = document.getElementById('searchInput');
        const timelineContainer = document.getElementById('timelineContainer');
        const refreshBtn = document.getElementById('refreshBtn');
        const quickSaveBtn = document.getElementById('quickSaveBtn');
        const themeToggle = document.getElementById('themeToggle');
        const recPanel = document.getElementById('recPanel');
        const recList = document.getElementById('recList');
        const recCloseBtn = document.getElementById('recCloseBtn');
        const batchBar = document.getElementById('batchBar');
        const selectedCountSpan = document.getElementById('selectedCount');
        const batchDeleteBtn = document.getElementById('batchDeleteBtn');
        const batchCancelBtn = document.getElementById('batchCancelBtn');
        const saveModal = document.getElementById('saveModal');
        const modalTitle = document.getElementById('modalTitle');
        const modalUrl = document.getElementById('modalUrl');
        const modalNote = document.getElementById('modalNote');
        const modalCancel = document.getElementById('modalCancel');
        const modalSave = document.getElementById('modalSave');
        const toolsBtn = document.getElementById('toolsBtn');
        const toolsDropdown = document.getElementById('toolsDropdown');
        const backupBtn = document.getElementById('backupBtn');
        const restoreBtn = document.getElementById('restoreBtn');
        const dedupBtn = document.getElementById('dedupBtn');
        const importFile = document.getElementById('importFileInput');

        // ---------- 全局数据 ----------
        let allBookmarks = [];
        let selectedIds = new Set();
        const STORAGE_KEY = 'bookmark_metadata_v2';

        // ---------- 辅助函数 ----------
        async function loadChromeBookmarks() {
            return new Promise((resolve) => {
                chrome.bookmarks.getTree((tree) => {
                    const results = [];
                    function traverse(nodes, path = []) {
                        for (const node of nodes) {
                            if (node.children) {
                                traverse(node.children, [...path, node.title]);
                            } else if (node.url) {
                                results.push({
                                    id: node.id,
                                    title: node.title || node.url,
                                    url: node.url,
                                    folderPath: path.filter(p => p).join(' / ') || '根目录',
                                    dateAdded: node.dateAdded || Date.now()
                                });
                            }
                        }
                    }
                    traverse(tree);
                    resolve(results);
                });
            });
        }

        async function loadMetadata() {
            const data = await new Promise(r => chrome.storage.local.get([STORAGE_KEY], r));
            const meta = data[STORAGE_KEY] || {};
            for (const b of allBookmarks) {
                b.summary = meta[b.id]?.summary || '';
                b.keywords = meta[b.id]?.keywords || [];
                b.note = meta[b.id]?.note || '';
            }
        }

        async function saveMetadataForBookmark(id, { summary, keywords, note }) {
            const data = await new Promise(r => chrome.storage.local.get([STORAGE_KEY], r));
            const meta = data[STORAGE_KEY] || {};
            meta[id] = { summary, keywords: keywords || [], note: note || '' };
            await chrome.storage.local.set({ [STORAGE_KEY]: meta });
        }

        function extractKeywords(title, url) {
            const text = (title + ' ' + url).toLowerCase();
            const common = ['the','a','an','and','of','to','in','for','on','with','by','from','at','is','it','be'];
            const words = text.split(/\W+/).filter(w => w.length > 2 && !common.includes(w));
            const freq = new Map();
            for (const w of words) freq.set(w, (freq.get(w)||0)+1);
            const sorted = [...freq.entries()].sort((a,b)=>b[1]-a[1]);
            return sorted.slice(0,5).map(v=>v[0]);
        }

        async function refreshData() {
            allBookmarks = await loadChromeBookmarks();
            await loadMetadata();
            for (const b of allBookmarks) {
                if (!b.summary) {
                    b.summary = `收录于 ${new Date(b.dateAdded).toLocaleDateString()} · ${b.folderPath}`;
                    b.keywords = extractKeywords(b.title, b.url);
                    await saveMetadataForBookmark(b.id, { summary: b.summary, keywords: b.keywords, note: b.note });
                }
            }
            renderTimeline();
        }

        function parseNaturalLanguage(query) {
            query = query.toLowerCase();
            const now = new Date();
            let startDate = null, endDate = null, keywords = [];
            if (query.includes('今天')) {
                startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
            } else if (query.includes('昨天')) {
                const yesterday = new Date(now);
                yesterday.setDate(now.getDate() - 1);
                startDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
                endDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate() + 1);
            } else if (query.includes('本周')) {
                const day = now.getDay();
                const diff = day === 0 ? 6 : day - 1;
                startDate = new Date(now);
                startDate.setDate(now.getDate() - diff);
                startDate.setHours(0,0,0,0);
                endDate = new Date(startDate);
                endDate.setDate(startDate.getDate() + 7);
            } else if (query.includes('本月')) {
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
            } else if (/\d{4}年/.test(query)) {
                const year = parseInt(query.match(/(\d{4})年/)[1]);
                startDate = new Date(year, 0, 1);
                endDate = new Date(year + 1, 0, 1);
            } else if (query.includes('上周')) {
                const lastWeekStart = new Date(now);
                lastWeekStart.setDate(now.getDate() - 7 - (now.getDay() || 7) + 1);
                lastWeekStart.setHours(0,0,0,0);
                startDate = lastWeekStart;
                endDate = new Date(lastWeekStart);
                endDate.setDate(lastWeekStart.getDate() + 7);
            }
            let remaining = query;
            const timeWords = ['今天','昨天','本周','上周','本月','去年','年','周','月'];
            for (const tw of timeWords) remaining = remaining.replace(tw, '');
            keywords = remaining.split(/\s+/).filter(w => w.length > 1);
            return { startDate, endDate, keywords };
        }

        function filterBookmarks(query) {
            if (!query.trim()) return allBookmarks;
            const { startDate, endDate, keywords } = parseNaturalLanguage(query);
            let filtered = allBookmarks;
            if (startDate && endDate) {
                filtered = filtered.filter(b => b.dateAdded >= startDate.getTime() && b.dateAdded < endDate.getTime());
            }
            if (keywords.length > 0) {
                filtered = filtered.filter(b => {
                    const haystack = (b.title + ' ' + b.url + ' ' + b.keywords.join(' ') + ' ' + b.summary).toLowerCase();
                    return keywords.every(kw => haystack.includes(kw));
                });
            }
            return filtered;
        }

        function groupByTime(bookmarks) {
            const todayStart = new Date(); todayStart.setHours(0,0,0,0);
            const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1);
            const weekStart = new Date(todayStart); weekStart.setDate(todayStart.getDate() - todayStart.getDay() + 1);
            const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
            const groups = { '今天': [], '昨天': [], '本周': [], '本月': [], '更早': [] };
            for (const b of bookmarks) {
                const ts = b.dateAdded;
                if (ts >= todayStart.getTime()) groups['今天'].push(b);
                else if (ts >= yesterdayStart.getTime()) groups['昨天'].push(b);
                else if (ts >= weekStart.getTime()) groups['本周'].push(b);
                else if (ts >= monthStart.getTime()) groups['本月'].push(b);
                else groups['更早'].push(b);
            }
            return groups;
        }

        // 推荐面板动态定位（优先左侧）
        function positionPanel(anchorElement, panel) {
            const rect = anchorElement.getBoundingClientRect();
            const panelWidth = 280;
            const panelHeight = panel.offsetHeight;
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            let left, top;
            const gap = 8;
            if (rect.left - panelWidth - gap >= 0) {
                left = rect.left - panelWidth - gap;
            } else {
                left = rect.right + gap;
            }
            if (left + panelWidth > viewportWidth) {
                left = Math.max(gap, viewportWidth - panelWidth - gap);
            }
            if (left < 0) left = gap;
            top = rect.top;
            if (top + panelHeight > viewportHeight) {
                top = rect.bottom - panelHeight;
            }
            if (top < 0) top = gap;
            if (top + panelHeight > viewportHeight) top = viewportHeight - panelHeight - gap;
            panel.style.left = left + 'px';
            panel.style.top = top + 'px';
        }

        function showRecommendations(bookmarkId, anchorElement) {
            const current = allBookmarks.find(b => b.id == bookmarkId);
            if (!current) return;
            const others = allBookmarks.filter(b => b.id != bookmarkId);
            const scores = others.map(b => ({
                bookmark: b,
                score: b.keywords.filter(k => current.keywords.includes(k)).length
            }));
            scores.sort((a,b) => b.score - a.score);
            const top5 = scores.slice(0,5);
            recList.innerHTML = top5.map(s => `<div class="rec-item" data-url="${escapeAttr(s.bookmark.url)}">${escapeHtml(s.bookmark.title)}</div>`).join('');
            recPanel.classList.add('show');
            recPanel.offsetHeight;
            positionPanel(anchorElement, recPanel);
            document.querySelectorAll('.rec-item').forEach(el => {
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const url = el.dataset.url;
                    if (url) chrome.tabs.create({ url });
                });
            });
        }

        function closeRecommendationPanel() {
            recPanel.classList.remove('show');
        }

        function renderTimeline() {
            const query = searchInput.value;
            const filtered = filterBookmarks(query);
            const groups = groupByTime(filtered);
            let html = '';
            for (const [groupName, items] of Object.entries(groups)) {
                if (items.length === 0) continue;
                html += `<div class="timeline-group">
                            <div class="group-header">
                                <span>${groupName}</span>
                                <span style="font-size:10px;">${items.length}</span>
                            </div>
                            <div class="bookmarks-grid">
                `;
                for (const item of items) {
                    const dateStr = new Date(item.dateAdded).toLocaleDateString();
                    const keywordsHtml = item.keywords.slice(0,3).map(k => `<span class="keyword">${escapeHtml(k)}</span>`).join('');
                    html += `
                        <div class="bookmark-item" data-id="${item.id}" data-url="${escapeAttr(item.url)}">
                            <div class="bookmark-info">
                                <div class="bookmark-title">
                                    <span>${escapeHtml(item.title.length > 60 ? item.title.slice(0,57)+'...' : item.title)}</span>
                                </div>
                                <div class="bookmark-url">${escapeHtml(item.url.slice(0,70))}${item.url.length>70?'...':''}</div>
                                <div class="bookmark-summary">${escapeHtml(item.summary || '无摘要')}</div>
                                <div class="bookmark-meta">
                                    <span>📅 ${dateStr}</span>
                                    <div class="keywords">${keywordsHtml}</div>
                                </div>
                            </div>
                            <div style="display:flex; gap:8px;">
                                <span class="btn" style="font-size:10px; padding:4px 8px;" data-action="recommend" data-id="${item.id}">🔍 相似</span>
                                <input type="checkbox" class="select-checkbox" data-id="${item.id}" style="width:18px; height:18px; cursor:pointer;">
                            </div>
                        </div>
                    `;
                }
                html += `</div></div>`;
            }
            if (filtered.length === 0) html = '<div class="empty-state">✨ 时空里没有找到书签，试试自然语言搜索</div>';
            timelineContainer.innerHTML = html;

            document.querySelectorAll('.bookmark-item').forEach(card => {
                const id = card.dataset.id;
                card.addEventListener('click', (e) => {
                    if (e.target.type === 'checkbox' || e.target.closest('[data-action]')) return;
                    const url = card.dataset.url;
                    if (url) chrome.tabs.create({ url }, () => window.close());
                });
                const recBtn = card.querySelector('[data-action="recommend"]');
                if (recBtn) {
                    recBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const btnId = recBtn.dataset.id;
                        if (btnId) showRecommendations(btnId, recBtn);
                    });
                }
                const cb = card.querySelector('.select-checkbox');
                if (cb) {
                    cb.addEventListener('change', (e) => {
                        e.stopPropagation();
                        if (cb.checked) selectedIds.add(id);
                        else selectedIds.delete(id);
                        updateBatchBar();
                    });
                }
            });
        }

        function updateBatchBar() {
            const count = selectedIds.size;
            selectedCountSpan.innerText = count;
            if (count > 0) batchBar.classList.add('show');
            else batchBar.classList.remove('show');
        }

        async function batchDelete() {
            if (!confirm(`删除 ${selectedIds.size} 个书签？`)) return;
            for (const id of selectedIds) {
                await new Promise(r => chrome.bookmarks.remove(id, r));
            }
            selectedIds.clear();
            await refreshData();
            updateBatchBar();
        }

        // ---------- 备份、恢复、去重 ----------
        async function backupBookmarks() {
            const data = {
                version: 3,
                date: new Date().toISOString(),
                bookmarks: allBookmarks.map(b => ({
                    id: b.id,
                    title: b.title,
                    url: b.url,
                    folderPath: b.folderPath,
                    dateAdded: b.dateAdded,
                    summary: b.summary,
                    keywords: b.keywords,
                    note: b.note
                }))
            };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `bookmark_backup_${new Date().toISOString().slice(0,19)}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
        }

        async function restoreBookmarks(file) {
            const text = await file.text();
            const data = JSON.parse(text);
            if (!data.bookmarks || !Array.isArray(data.bookmarks)) {
                alert('无效的备份文件');
                return;
            }
            if (!confirm(`此操作将添加 ${data.bookmarks.length} 个书签（不会覆盖现有），是否继续？`)) return;
            for (const bm of data.bookmarks) {
                if (!bm.url) continue;
                // 检查是否已存在相同 URL
                const exists = allBookmarks.some(b => b.url === bm.url);
                if (exists) continue;
                const newBm = await new Promise(r => chrome.bookmarks.create({ title: bm.title, url: bm.url }, r));
                await saveMetadataForBookmark(newBm.id, {
                    summary: bm.summary || '',
                    keywords: bm.keywords || [],
                    note: bm.note || ''
                });
            }
            await refreshData();
            alert(`恢复完成，新增了 ${data.bookmarks.filter(b => !allBookmarks.some(ab => ab.url === b.url)).length} 个书签`);
        }

        async function deduplicateBookmarks() {
            const urlMap = new Map();
            for (const b of allBookmarks) {
                if (!urlMap.has(b.url)) urlMap.set(b.url, []);
                urlMap.get(b.url).push(b);
            }
            const duplicates = [];
            for (const list of urlMap.values()) {
                if (list.length > 1) {
                    list.sort((a,b) => a.dateAdded - b.dateAdded);
                    duplicates.push(...list.slice(1));
                }
            }
            if (duplicates.length === 0) {
                alert('没有重复书签');
                return;
            }
            if (confirm(`发现 ${duplicates.length} 个重复书签，是否删除？`)) {
                for (const dup of duplicates) {
                    await new Promise(r => chrome.bookmarks.remove(dup.id, r));
                }
                await refreshData();
                alert(`已删除 ${duplicates.length} 个重复书签`);
            }
        }

        // 工具下拉菜单动态定位
        function positionToolsDropdown() {
            const rect = toolsBtn.getBoundingClientRect();
            let top = rect.bottom + 5;
            let left = rect.left;
            const panelHeight = toolsDropdown.offsetHeight;
            if (top + panelHeight > window.innerHeight) {
                top = rect.top - panelHeight - 5;
            }
            toolsDropdown.style.top = `${top}px`;
            toolsDropdown.style.left = `${left}px`;
        }

        function closeToolsDropdown() {
            toolsDropdown.classList.remove('show');
        }

        // 主题切换
        function toggleTheme() {
            const current = document.documentElement.getAttribute('data-theme');
            const newTheme = current === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
        }
        function loadTheme() {
            const saved = localStorage.getItem('theme') || 'light';
            document.documentElement.setAttribute('data-theme', saved);
        }

        function escapeHtml(str) { return String(str).replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'})[m]); }
        function escapeAttr(str) { return String(str).replace(/"/g, '&quot;'); }

        // 全局点击关闭面板
        function setupGlobalClick() {
            document.addEventListener('click', (e) => {
                if (recPanel.classList.contains('show')) {
                    const isInside = recPanel.contains(e.target);
                    const isRecommendBtn = e.target.closest && e.target.closest('[data-action="recommend"]');
                    if (!isInside && !isRecommendBtn) closeRecommendationPanel();
                }
                if (toolsDropdown.classList.contains('show')) {
                    if (!toolsDropdown.contains(e.target) && e.target !== toolsBtn) closeToolsDropdown();
                }
            });
            window.addEventListener('resize', () => {
                if (recPanel.classList.contains('show')) {
                    const activeBtn = document.querySelector('[data-action="recommend"]:hover');
                    if (activeBtn) positionPanel(activeBtn, recPanel);
                }
                if (toolsDropdown.classList.contains('show')) positionToolsDropdown();
            });
        }

        function bindEvents() {
            searchInput.addEventListener('input', () => renderTimeline());
            refreshBtn.onclick = refreshData;
            quickSaveBtn.onclick = quickSave;
            themeToggle.onclick = toggleTheme;
            batchDeleteBtn.onclick = batchDelete;
            batchCancelBtn.onclick = () => { selectedIds.clear(); updateBatchBar(); renderTimeline(); };
            modalCancel.onclick = () => saveModal.classList.remove('show');
            modalSave.onclick = performSave;
            recCloseBtn.onclick = closeRecommendationPanel;
            toolsBtn.onclick = (e) => {
                e.stopPropagation();
                if (toolsDropdown.classList.contains('show')) {
                    closeToolsDropdown();
                } else {
                    closeRecommendationPanel();
                    positionToolsDropdown();
                    toolsDropdown.classList.add('show');
                }
            };
            backupBtn.onclick = () => { backupBookmarks(); closeToolsDropdown(); };
            restoreBtn.onclick = () => { importFile.click(); closeToolsDropdown(); };
            dedupBtn.onclick = () => { deduplicateBookmarks(); closeToolsDropdown(); };
            importFile.onchange = (e) => {
                if (e.target.files[0]) restoreBookmarks(e.target.files[0]);
                importFile.value = '';
            };
        }

        async function quickSave() {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            modalTitle.value = tab.title.replace(/[-_]\s*(知乎|百度|CSDN|GitHub)$/i, '').trim();
            modalUrl.value = tab.url;
            modalNote.value = `自动收藏自 ${new URL(tab.url).hostname}`;
            saveModal.classList.add('show');
        }

        async function performSave() {
            const title = modalTitle.value.trim();
            const url = modalUrl.value.trim();
            if (!title || !url) return alert('请填写完整');
            if (allBookmarks.some(b => b.url === url)) {
                if (!confirm('书签已存在，继续添加？')) return;
            }
            const newBookmark = await new Promise(r => chrome.bookmarks.create({ title, url }, r));
            const keywords = extractKeywords(title, url);
            const summary = modalNote.value.trim() || `收藏于 ${new Date().toLocaleDateString()}`;
            await saveMetadataForBookmark(newBookmark.id, { summary, keywords, note: summary });
            await refreshData();
            saveModal.classList.remove('show');
        }

        async function init() {
            loadTheme();
            await refreshData();
            bindEvents();
            setupGlobalClick();
        }
        init();
    })();