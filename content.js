(() => {
    const looksLikeJson = () => {
        const text = document.body?.innerText?.trim();
        return text?.startsWith('{') || text?.startsWith('[');
    };

    if (!document.contentType?.includes('application/json') && !looksLikeJson()) return;

    const raw = document.body.innerText;
    try {
        JSON.parse(raw); // validate
    } catch (e) {
        console.error(e)
        return;
    }
    // --- State ---
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return; }

    let searchQuery = '';
    let matchPaths = new Set();   // dot-paths of nodes with matches
    let collapsedPaths = new Set();

    // --- Inject styles ---
    const style = document.createElement('style');
    style.textContent = `
    *, *::before, *::after { box-sizing: border-box; }

    body {
        margin: 0;
        background: #0d1117;
        color: #c9d1d9;
        font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
        font-size: 13px;
        line-height: 1.6;
    }

    /* Toolbar */
    #jv-toolbar {
        position: sticky;
        top: 0;
        z-index: 100;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 16px;
        background: #161b22;
        border-bottom: 1px solid #30363d;
        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    }

    #jv-search {
        flex: 1;
        max-width: 360px;
        padding: 6px 12px 6px 32px;
        background: #0d1117;
        border: 1px solid #30363d;
        border-radius: 6px;
        color: #c9d1d9;
        font-family: inherit;
        font-size: 13px;
        outline: none;
        transition: border-color 0.15s;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%236e7681' stroke-width='2'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cpath d='m21 21-4.35-4.35'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: 10px center;
    }
    #jv-search:focus { border-color: #388bfd; }
    #jv-search.has-results { border-color: #3fb950; }
    #jv-search.no-results { border-color: #f85149; }

    #jv-match-count {
        font-size: 12px;
        color: #6e7681;
        white-space: nowrap;
    }

    .jv-btn {
        padding: 5px 12px;
        background: #21262d;
        border: 1px solid #30363d;
        border-radius: 6px;
        color: #c9d1d9;
        font-family: inherit;
        font-size: 12px;
        cursor: pointer;
        transition: background 0.15s, border-color 0.15s;
        white-space: nowrap;
    }
    .jv-btn:hover { background: #30363d; border-color: #8b949e; }

    /* Content */
    #jv-content {
        padding: 16px;
    }

    /* Tree nodes */
    .jv-node { display: block; }

    .jv-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        margin-right: 4px;
        border-radius: 3px;
        cursor: pointer;
        color: #6e7681;
        user-select: none;
        vertical-align: middle;
        font-size: 10px;
        transition: color 0.1s, background 0.1s;
        flex-shrink: 0;
    }
    .jv-toggle:hover { background: #21262d; color: #c9d1d9; }

    .jv-children { padding-left: 20px; border-left: 1px solid #21262d; margin-left: 7px; }

    .jv-collapsed > .jv-children { display: none; }

    .jv-summary {
        color: #6e7681;
        font-style: italic;
        cursor: pointer;
        user-select: none;
    }
    .jv-summary:hover { color: #8b949e; }

    /* Token colors — VS Code Dark+ inspired */
    .jv-key   { color: #79c0ff; }
    .jv-str   { color: #a5d6ff; }
    .jv-num   { color: #79c0ff; }
    .jv-bool  { color: #ff7b72; }
    .jv-null  { color: #ff7b72; }
    .jv-punct { color: #6e7681; }

    /* Search highlight */
    .jv-hl {
        background: #bb800966;
        border-radius: 2px;
        color: #e3b341;
    }

    /* Dim non-matching lines when searching */
    body.searching .jv-node:not(.jv-match):not(.jv-match-parent) {
        opacity: 0.3;
    }
    body.searching .jv-node.jv-match,
    body.searching .jv-node.jv-match-parent {
        opacity: 1;
    }
    `;
    document.head.appendChild(style);

    // --- Build DOM ---
    document.body.innerHTML = '';
    document.body.style.margin = '0';

    const toolbar = document.createElement('div');
    toolbar.id = 'jv-toolbar';

    const search = document.createElement('input');
    search.id = 'jv-search';
    search.type = 'text';
    search.placeholder = 'Search keys and values…';
    search.setAttribute('autocomplete', 'off');
    search.setAttribute('spellcheck', 'false');

    const matchCount = document.createElement('span');
    matchCount.id = 'jv-match-count';

    const btnExpandAll = document.createElement('button');
    btnExpandAll.className = 'jv-btn';
    btnExpandAll.textContent = 'Expand all';

    const btnCollapseAll = document.createElement('button');
    btnCollapseAll.className = 'jv-btn';
    btnCollapseAll.textContent = 'Collapse all';

    toolbar.append(search, matchCount, btnExpandAll, btnCollapseAll);

    const content = document.createElement('div');
    content.id = 'jv-content';

    document.body.append(toolbar, content);

    // --- Rendering ---
    // Each node element gets a data-path attribute for lookup

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function highlight(text) {
        if (!searchQuery) return escapeHtml(text);
        const escaped = escapeHtml(text);
        const escapedQuery = escapeHtml(searchQuery).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return escaped.replace(new RegExp(escapedQuery, 'gi'), m => `<span class="jv-hl">${m}</span>`);
    }

    function makeScalar(value) {
        if (value === null) return `<span class="jv-null">null</span>`;
        if (typeof value === 'boolean') return `<span class="jv-bool">${value}</span>`;
        if (typeof value === 'number') return `<span class="jv-num">${highlight(String(value))}</span>`;
        if (typeof value === 'string') return `<span class="jv-str">"${highlight(value)}"</span>`;
        return escapeHtml(String(value));
    }

    function nodeMatches(value, key) {
        if (!searchQuery) return false;
        const q = searchQuery.toLowerCase();
        if (key !== null && String(key).toLowerCase().includes(q)) return true;
        if (value === null) return 'null'.includes(q);
        if (typeof value === 'boolean') return String(value).includes(q);
        if (typeof value !== 'object') return String(value).toLowerCase().includes(q);
        return false;
    }

    function buildNode(value, key, path) {
        const wrapper = document.createElement('div');
        wrapper.className = 'jv-node';
        wrapper.dataset.path = path;

        const isObject = value !== null && typeof value === 'object';
        const entries = isObject ? (Array.isArray(value) ? value.map((v, i) => [i, v]) : Object.entries(value)) : null;
        const count = entries ? entries.length : 0;

        // Line header
        const line = document.createElement('div');
        line.style.display = 'flex';
        line.style.alignItems = 'center';
        line.style.minHeight = '22px';

        // Toggle button (only for objects/arrays)
        if (isObject && count > 0) {
            const toggle = document.createElement('span');
            toggle.className = 'jv-toggle';
            toggle.textContent = '▾';
            toggle.title = 'Click to collapse';
            toggle.addEventListener('click', () => toggleNode(wrapper, toggle));
            line.appendChild(toggle);
        } else {
            const spacer = document.createElement('span');
            spacer.style.display = 'inline-block';
            spacer.style.width = '20px';
            line.appendChild(spacer);
        }

        // Key
        if (key !== null) {
            const keyEl = document.createElement('span');
            keyEl.className = 'jv-key';
            keyEl.innerHTML = `"${highlight(String(key))}"`;
            line.appendChild(keyEl);
            const colon = document.createElement('span');
            colon.className = 'jv-punct';
            colon.textContent = ': ';
            line.appendChild(colon);
        }

        if (!isObject) {
            const val = document.createElement('span');
            val.innerHTML = makeScalar(value);
            line.appendChild(val);
        } else if (count === 0) {
            const empty = document.createElement('span');
            empty.className = 'jv-punct';
            empty.textContent = Array.isArray(value) ? '[]' : '{}';
            line.appendChild(empty);
        } else {
            // Opening bracket + collapsed summary
            const open = document.createElement('span');
            open.className = 'jv-punct';
            open.textContent = Array.isArray(value) ? '[' : '{';
            line.appendChild(open);

            const summary = document.createElement('span');
            summary.className = 'jv-summary';
            summary.textContent = ` ${count} ${count === 1 ? 'item' : 'items'} `;
            summary.title = 'Click to expand';
            summary.addEventListener('click', () => toggleNode(wrapper, wrapper.querySelector('.jv-toggle')));
            line.appendChild(summary);

            const closedBracket = document.createElement('span');
            closedBracket.className = 'jv-punct';
            closedBracket.textContent = Array.isArray(value) ? ']' : '}';
            line.appendChild(closedBracket);
        }

        wrapper.appendChild(line);

        // Children
        if (isObject && count > 0) {
            const children = document.createElement('div');
            children.className = 'jv-children';

            entries.forEach(([k, v], idx) => {
                const child = buildNode(v, k, `${path}.${k}`);
                // Add comma to all but last
                if (idx < count - 1) {
                    child.querySelector('div').insertAdjacentHTML('beforeend', '<span class="jv-punct">,</span>');
                }
                children.appendChild(child);
            });

            // Closing bracket on its own line
            const closeLine = document.createElement('div');
            closeLine.innerHTML = `<span style="display:inline-block;width:20px"></span><span class="jv-punct">${Array.isArray(value) ? ']' : '}'}</span>`;
            wrapper.appendChild(children);
            wrapper.appendChild(closeLine);
        }

        return wrapper;
    }

    function toggleNode(wrapper, toggleEl) {
        const isCollapsed = wrapper.classList.contains('jv-collapsed');
        if (isCollapsed) {
            wrapper.classList.remove('jv-collapsed');
            if (toggleEl) { toggleEl.textContent = '▾'; toggleEl.title = 'Click to collapse'; }
        } else {
            wrapper.classList.add('jv-collapsed');
            if (toggleEl) { toggleEl.textContent = '▸'; toggleEl.title = 'Click to expand'; }
        }
    }

    function setAllCollapsed(collapsed) {
        content.querySelectorAll('.jv-node').forEach(node => {
            const children = node.querySelector('.jv-children');
            if (!children) return;
            const toggle = node.querySelector('.jv-toggle');
            if (collapsed) {
                node.classList.add('jv-collapsed');
                if (toggle) { toggle.textContent = '▸'; toggle.title = 'Click to expand'; }
            } else {
                node.classList.remove('jv-collapsed');
                if (toggle) { toggle.textContent = '▾'; toggle.title = 'Click to collapse'; }
            }
        });
    }

    // --- Search logic ---
    function getAllValues(value, key, path, results) {
        if (nodeMatches(value, key)) results.add(path);
        if (value !== null && typeof value === 'object') {
            const entries = Array.isArray(value) ? value.map((v, i) => [i, v]) : Object.entries(value);
            entries.forEach(([k, v]) => getAllValues(v, k, `${path}.${k}`, results));
        }
    }

    function getParentPaths(path) {
        const parts = path.split('.');
        const parents = new Set();
        for (let i = 1; i < parts.length; i++) {
            parents.add(parts.slice(0, i).join('.'));
        }
        return parents;
    }

    function applySearch() {
        matchPaths.clear();
        const parentPaths = new Set();

        if (searchQuery) {
            getAllValues(parsed, null, 'root', matchPaths);
            matchPaths.forEach(p => getParentPaths(p).forEach(pp => parentPaths.add(pp)));
            document.body.classList.add('searching');
        } else {
            document.body.classList.remove('searching');
        }

        const count = matchPaths.size;

        // Update match count display
        if (!searchQuery) {
            matchCount.textContent = '';
            search.className = '';
        } else {
            matchCount.textContent = count === 0 ? 'No matches' : `${count} match${count !== 1 ? 'es' : ''}`;
            search.className = count === 0 ? 'no-results' : 'has-results';
        }

        // Update node classes & expand matching paths
        content.querySelectorAll('.jv-node').forEach(node => {
            const path = node.dataset.path;
            const isMatch = matchPaths.has(path);
            const isParent = parentPaths.has(path);

            node.classList.toggle('jv-match', isMatch);
            node.classList.toggle('jv-match-parent', isParent && !isMatch);

            // Auto-expand parents of matches
            if (searchQuery && (isMatch || isParent)) {
                node.classList.remove('jv-collapsed');
                const toggle = node.querySelector(':scope > div > .jv-toggle');
                if (toggle) { toggle.textContent = '▾'; toggle.title = 'Click to collapse'; }
            }
        });

        // Re-render highlights: rebuild content with new highlight
        // Instead, we use innerHTML updates on scalar/key spans
        // Actually, we rebuild the whole tree when query changes for simplicity
    }

    // --- Render tree ---
    function render() {
        content.innerHTML = '';
        const root = buildNode(parsed, null, 'root');
        content.appendChild(root);
        applySearch();
    }

    render();

    // --- Events ---
    let searchDebounce;
    search.addEventListener('input', () => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => {
            searchQuery = search.value.trim();
            render();
        }, 150);
    });

    btnExpandAll.addEventListener('click', () => setAllCollapsed(false));
    btnCollapseAll.addEventListener('click', () => setAllCollapsed(true));

    // Focus search on Cmd/Ctrl+F or just /
    document.addEventListener('keydown', e => {
        if ((e.key === 'f' && (e.metaKey || e.ctrlKey)) || e.key === '/') {
            if (document.activeElement !== search) {
                e.preventDefault();
                search.focus();
                search.select();
            }
        }
        if (e.key === 'Escape' && document.activeElement === search) {
            search.value = '';
            searchQuery = '';
            render();
            search.blur();
        }
    });
})();
