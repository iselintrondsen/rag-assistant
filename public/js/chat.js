












'use strict';



const uploadForm    = document.getElementById('uploadForm');
const fileInput     = document.getElementById('fileInput');
const fileLabel     = document.getElementById('fileLabel');
const uploadBtn     = document.getElementById('uploadBtn');
const uploadStatus  = document.getElementById('uploadStatus');
const refreshBtn    = document.getElementById('refreshBtn');
const documentsList = document.getElementById('documentsList');
const chatMessages  = document.getElementById('chatMessages');
const messageInput  = document.getElementById('messageInput');
const sendBtn       = document.getElementById('sendBtn');
const clearBtn           = document.getElementById('clearBtn');
const dbStatus           = document.getElementById('dbStatus');
const scrollToBottomBtn  = document.getElementById('scrollToBottomBtn');
const charCount          = document.getElementById('charCount');



const tmplUser      = document.getElementById('tmpl-user-message');
const tmplAssistant = document.getElementById('tmpl-assistant-message');
const tmplSourceItem= document.getElementById('tmpl-source-row');
const tmplLoading   = document.getElementById('tmpl-loading');
const tmplDocItem   = document.getElementById('tmpl-doc-item');



let isWaitingForAnswer  = false;
let conversationHistory = [];


const SESSION_KEY = 'is217-chat-session';
const APP_CONFIG = window.APP_CONFIG || {};
const canManageKb = APP_CONFIG.canManageKb === true || APP_CONFIG.canManageKb === 'true';



document.addEventListener('DOMContentLoaded', () => {
  restoreSession();
  if (canManageKb) {
    loadDocuments();
  } else {
    setDbStatus(true);
  }
  messageInput.focus();
  initWelcomeSuggestions();
});



function saveSession() {
  try {
    
    const payload = JSON.stringify(conversationHistory.slice(-20));
    localStorage.setItem(SESSION_KEY, payload);
  } catch {  }
}

function restoreSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const history = JSON.parse(raw);
    if (!Array.isArray(history) || history.length === 0) return;

    conversationHistory = history;
    hideWelcome();

    
    for (const msg of history) {
      if (msg.role === 'user') {
        appendUserMessage(msg.content);
      } else if (msg.role === 'assistant') {
        const fragment = tmplAssistant.content.cloneNode(true);
        const node     = fragment.querySelector('.message.msg-assistant');
        const answerEl = node.querySelector('.answer-text');
        const copyBtn  = node.querySelector('.btn-copy');

        answerEl.innerHTML = marked.parse(msg.content);
        setupCopyButton(copyBtn, msg.content);

        
        const suggestionsEl = node.querySelector('.suggestions-row');
        if (suggestionsEl) suggestionsEl.classList.add('hidden');

        chatMessages.appendChild(node);
      }
    }

    
  const notice = document.createElement('div');
  notice.className = 'session-notice';
  notice.textContent = `↩  Du kan fortsette samtalen her`;
  chatMessages.appendChild(notice);
    scrollToBottom();
  } catch {  }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}



function initWelcomeSuggestions() {
  const chips = document.querySelectorAll('#welcomeSuggestions .chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      messageInput.value = chip.textContent;
      messageInput.dispatchEvent(new Event('input')); 
      sendMessage();
    });
  });
}


function hideWelcome() {
  const welcome = document.getElementById('welcomeMessage');
  if (welcome) welcome.remove();
}



if (canManageKb && fileInput && fileLabel && uploadBtn && uploadForm) {
  fileInput.addEventListener('change', () => {
    const count = fileInput.files.length;
    if (count > 0) {
      fileLabel.textContent = count === 1
        ? `📄 ${truncate(fileInput.files[0].name, 30)}`
        : `📄 ${count} filer valgt`;
      fileLabel.closest('label').classList.add('has-file');
      uploadBtn.disabled = false;
    } else {
      resetFileInput();
    }
  });

  uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const files = fileInput.files;
    if (!files.length) {
      showUploadStatus('Velg minst én fil først.', 'err');
      return;
    }

    const formData = new FormData();
    for (const file of files) formData.append('documents', file);

    uploadBtn.disabled = true;
    showUploadStatus(
      files.length === 1
        ? `⏳ Leser "${files[0].name}"…`
        : `⏳ Leser ${files.length} filer…`,
      'loading'
    );

    try {
      const res  = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();

      if (res.status === 500) throw new Error(data.error || 'Noen filer ble ikke lastet.');

      const docs   = data.documents || [];
      const errors = data.errors    || [];

      let msg = '';
      if (docs.length > 0) {
        const totalChunks = docs.reduce((sum, d) => sum + d.chunks, 0);
        msg += docs.length === 1
          ? `✅ "${docs[0].name}" lastet opp (${docs[0].chunks} chunks)`
          : `✅ ${docs.length} filer lastet opp (${totalChunks} chunks totalt)`;
      }
      if (errors.length > 0) {
        msg += `${msg ? '\n' : ''}⚠️ Kunne ikke laste: ${errors.map(e => `"${e.name}"`).join(', ')}`;
      }

      showUploadStatus(msg, errors.length === 0 ? 'ok' : 'err');
      resetFileInput();
      await loadDocuments();
      setDbStatus(true);

    } catch (err) {
      showUploadStatus(`❌ ${err.message}`, 'err');
      uploadBtn.disabled = false;
    }
  });
}

function showUploadStatus(message, type) {
  if (!uploadStatus) return;
  uploadStatus.textContent = message;
  uploadStatus.className   = `upload-status ${type}`;
  uploadStatus.classList.remove('hidden');
}

function resetFileInput() {
  if (!fileInput || !fileLabel || !uploadBtn) return;
  fileInput.value       = '';
  fileLabel.textContent = 'Velg fil(er) (PDF, DOCX, TXT, MD)';
  fileLabel.closest('label').classList.remove('has-file');
  uploadBtn.disabled    = true;
}



if (canManageKb && refreshBtn) {
  refreshBtn.addEventListener('click', loadDocuments);
}

async function loadDocuments() {
  if (!documentsList) return;
  try {
    const res  = await fetch('/api/documents');
    const docs = await res.json();
    if (!res.ok) throw new Error(docs.error || 'Kunne ikke hente dokumentlisten');
    renderDocuments(docs);
    setDbStatus(true);
  } catch (err) {
    documentsList.innerHTML = `<p class="empty-state" style="color:#ef4444">${err.message}</p>`;
    setDbStatus(false);
  }
}

function renderDocuments(docs) {
  if (!documentsList) return;
  documentsList.innerHTML = '';

  if (!docs.length) {
    documentsList.innerHTML = '<p class="empty-state">Ingen dokumenter ennå.<br/>Last opp ditt første dokument!</p>';
    return;
  }

  docs.forEach(doc => {
    const node = tmplDocItem.content.cloneNode(true);

    node.querySelector('.doc-icon').textContent = fileIcon(doc.file_type);
    node.querySelector('.doc-name').textContent = doc.original_name;
    node.querySelector('.doc-meta').textContent =
      `${doc.chunk_count} chunks · ${formatSize(doc.file_size)} · ${formatDate(doc.uploaded_at)}`;

    
    node.querySelector('.btn-summarize').addEventListener('click', () => {
      messageInput.value = `Kan du gi meg et kort sammendrag av "${doc.original_name}"?`;
      messageInput.dispatchEvent(new Event('input'));
      messageInput.focus();
      sendMessage();
    });

    node.querySelector('.btn-delete').addEventListener('click', () =>
      deleteDocument(doc.id, doc.original_name)
    );

    documentsList.appendChild(node);
  });
}

async function deleteDocument(id, name) {
  if (!confirm(`Slett "${name}" og alt materiale knyttet til dokumentet?`)) return;
  try {
    const res  = await fetch(`/api/documents/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    await loadDocuments();
  } catch (err) {
    alert(`Klarte ikke slette dokumentet: ${err.message}`);
  }
}



messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!isWaitingForAnswer) sendMessage();
  }
});

sendBtn.addEventListener('click', () => {
  if (!isWaitingForAnswer) sendMessage();
});

clearBtn.addEventListener('click', () => {
  conversationHistory = [];
  chatMessages.innerHTML = '';
  clearSession();
});

messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 120)}px`;
  updateCharCount();
});



async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text) return;

  hideWelcome();
  appendUserMessage(text);
  messageInput.value = '';
  messageInput.style.height = 'auto';
  updateCharCount();

  const loadingEl = showLoading();
  isWaitingForAnswer = true;
  sendBtn.disabled   = true;

  let assistantNode  = null;
  let answerEl       = null;
  let detailsEl      = null;
  let sourceListEl   = null;
  let countEl        = null;
  let suggestionsEl  = null;
  let copyBtn        = null;
  let fullAnswer     = '';

  try {
    const response = await fetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message: text, history: conversationHistory }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Noe gikk galt med svaret' }));
      throw new Error(err.error || `HTTP ${response.status}`);
    }

    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;

        let event;
        try { event = JSON.parse(line.slice(6)); }
        catch { continue; }

        
        if (event.status) {
          const statusEl = loadingEl && loadingEl.querySelector('.loading-label');
          if (statusEl) statusEl.textContent = event.text || '';
        }

        
        if (event.error && answerEl) {
          answerEl.innerHTML = `<span style="color:#ef4444">⚠️ ${escapeHtml(event.error)}</span>`;
        }

        
        if (event.delta) {
          if (!assistantNode) {
            loadingEl.remove();
            const created  = createAssistantNode();
            assistantNode  = created.node;
            answerEl       = created.answerEl;
            detailsEl      = created.detailsEl;
            sourceListEl   = created.sourceListEl;
            countEl        = created.countEl;
            suggestionsEl  = created.suggestionsEl;
            copyBtn        = created.copyBtn;
            chatMessages.appendChild(assistantNode);
          }
          fullAnswer += event.delta;
          answerEl.innerHTML = renderMarkdown(fullAnswer);
          scrollToBottom();
        }

        
        if (event.done) {
          const sources = event.sources || [];
          if (sources.length > 0) {
            countEl.textContent = sources.length;
            sources.forEach(src => {
              const item = tmplSourceItem.content.cloneNode(true);
              item.querySelector('.source-doc').textContent     = src.document;
              item.querySelector('.source-score').textContent   = `${src.similarity}% treff`;
              item.querySelector('.source-text').textContent = src.snippet;
              sourceListEl.appendChild(item);
            });
            detailsEl.classList.remove('hidden');
          }
          
          if (copyBtn) setupCopyButton(copyBtn, fullAnswer);
          if (answerEl) wrapCodeBlocks(answerEl);
        }

        
        if (event.suggestions && suggestionsEl && event.suggestions.length > 0) {
          event.suggestions.forEach(q => {
            const chip = document.createElement('button');
            chip.className   = 'chip';
            chip.textContent = q;
            chip.addEventListener('click', () => {
              messageInput.value = q;
              messageInput.dispatchEvent(new Event('input'));
              sendMessage();
            });
            suggestionsEl.appendChild(chip);
          });
          suggestionsEl.classList.remove('hidden');
        }
      }
    }

    conversationHistory.push({ role: 'user',      content: text });
    conversationHistory.push({ role: 'assistant', content: fullAnswer });
    saveSession();

  } catch (err) {
    loadingEl.remove();
    if (answerEl) {
      answerEl.innerHTML = `<span style="color:#ef4444">⚠️ Klarte ikke å fullføre dette akkurat nå: ${escapeHtml(err.message)}</span>`;
    } else {
      appendAssistantFallback(`⚠️ Klarte ikke å fullføre dette akkurat nå: ${err.message}`);
    }
  } finally {
    isWaitingForAnswer = false;
    sendBtn.disabled   = false;
    messageInput.focus();
    scrollToBottom();
  }
}



function appendUserMessage(text) {
  const node = tmplUser.content.cloneNode(true);
  node.querySelector('.msg-bubble').innerHTML = escapeHtml(text).replace(/\n/g, '<br>');
  chatMessages.appendChild(node);
  scrollToBottom();
}

function createAssistantNode() {
  const fragment    = tmplAssistant.content.cloneNode(true);
  const node        = fragment.querySelector('.message.msg-assistant');
  const answerEl    = node.querySelector('.answer-text');
  const detailsEl   = node.querySelector('.sources');
  const sourceListEl= node.querySelector('.sources-list');
  const countEl     = node.querySelector('.source-count');
  const suggestionsEl = node.querySelector('.suggestions-row');
  const copyBtn     = node.querySelector('.btn-copy');

  answerEl.innerHTML = '<span class="streaming-cursor">▍</span>';

  return { node, answerEl, detailsEl, sourceListEl, countEl, suggestionsEl, copyBtn };
}

function appendAssistantFallback(message) {
  const fragment = tmplAssistant.content.cloneNode(true);
  fragment.querySelector('.answer-text').innerHTML =
    `<span style="color:#ef4444">${escapeHtml(message)}</span>`;
  chatMessages.appendChild(fragment);
  scrollToBottom();
}

function showLoading() {
  const node = tmplLoading.content.cloneNode(true).children[0];
  chatMessages.appendChild(node);
  scrollToBottom();
  return node;
}



function setupCopyButton(btn, markdownText) {
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(markdownText);
      btn.textContent = '✓';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = '📋';
        btn.classList.remove('copied');
      }, 2000);
    } catch {
      
      const ta = document.createElement('textarea');
      ta.value = markdownText;
      ta.style.position = 'fixed';
      ta.style.opacity  = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = '📋'; }, 2000);
    }
  });
}



function updateCharCount() {
  if (!charCount) return;
  const len = messageInput.value.length;
  const max = 2000;
  if (len === 0) {
    charCount.textContent = '';
    charCount.className = 'char-count';
    return;
  }
  charCount.textContent = `${len}/${max} · `;
  charCount.className = `char-count${len > 1800 ? ' danger' : len > 1400 ? ' warn' : ''}`;
}

function setDbStatus(ok) {
  dbStatus.className = `status-pill ${ok ? 'ok' : 'err'}`;
  dbStatus.querySelector('.status-label').textContent = ok ? 'Tilkoblet' : 'Ingen kontakt';
}



function scrollToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

if (scrollToBottomBtn) {
  chatMessages.addEventListener('scroll', () => {
    const distFromBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight;
    if (distFromBottom > 250) {
      scrollToBottomBtn.classList.remove('hidden');
    } else {
      scrollToBottomBtn.classList.add('hidden');
    }
  });
  scrollToBottomBtn.addEventListener('click', () => {
    scrollToBottom();
    scrollToBottomBtn.classList.add('hidden');
  });
}

function wrapCodeBlocks(container) {
  container.querySelectorAll('pre').forEach(pre => {
    if (pre.parentElement.classList.contains('code-wrapper')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'code-wrapper';
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);
    const btn = document.createElement('button');
    btn.className = 'btn-copy-code';
    btn.textContent = 'Kopier';
    btn.addEventListener('click', async () => {
      const code = pre.querySelector('code')?.textContent ?? pre.textContent;
      try {
        await navigator.clipboard.writeText(code);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = code;
        ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      btn.textContent = '✓ Kopiert';
      setTimeout(() => { btn.textContent = 'Kopier'; }, 2000);
    });
    wrapper.prepend(btn);
  });
}

function truncate(str, maxLen) {
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
}

function formatSize(bytes) {
  if (!bytes)          return '?';
  if (bytes < 1024)    return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('no-NO', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function fileIcon(type) {
  const icons = { pdf: '📄', docx: '📝', txt: '📃', md: '📋' };
  return icons[type] || '📁';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}



(function configureMarked() {
  if (typeof marked === 'undefined') return;
  marked.use({ breaks: true, gfm: true });
})();

function renderMarkdown(text) {
  if (typeof marked === 'undefined') {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }
  return marked.parse(text);
}
