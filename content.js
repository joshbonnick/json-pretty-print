function syntaxHighlight(json) {
    return json.replace(
        /("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
        match => {
            let cls = 'number';
            if (/^"/.test(match)) {
                cls = /:$/.test(match) ? 'key' : 'string';
            } else if (/true|false/.test(match)) {
                cls = 'boolean';
            } else if (/null/.test(match)) {
                cls = 'null';
            }
            return `<span class="${cls}">${match}</span>`;
        }
    );
}

// Fallback check (some servers send wrong content-type)
const looksLikeJson = () => {
    const text = document.body?.innerText?.trim();
    return text?.startsWith('{') || text?.startsWith('[');
};

(() => {
    if (!document.contentType?.includes('application/json') && !looksLikeJson()) {
        return;
    }

    const style = document.createElement('style');
    style.textContent = `
  .string { color: #ce9178; }
  .number { color: #b5cea8; }
  .boolean { color: #569cd6; }
  .null { color: #569cd6; }
  .key { color: #9cdcfe; }
`;
    document.head.appendChild(style);

    try {
        const raw = document.body.innerText;
        const parsed = JSON.parse(raw);
        const pretty = JSON.stringify(parsed, null, 2);

        // Replace page content
        document.body.innerHTML = '';

        const pre = document.createElement('pre');
        pre.innerHTML = syntaxHighlight(pretty);

        // Basic styling
        Object.assign(pre.style, {
            fontFamily: 'monospace',
            fontSize: '14px',
            lineHeight: '1.5',
            padding: '16px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word'
        });

        document.body.style.margin = '0';
        document.body.style.background = '#1e1e1e';
        document.body.style.color = '#d4d4d4';

        document.body.appendChild(pre);
    } catch {
        // Not valid JSON
    }
})();
