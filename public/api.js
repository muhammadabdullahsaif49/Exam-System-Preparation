// Shared fetch helpers

async function apiGet(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Something went wrong.');
  return body;
}

async function apiSend(method, url, data) {
  const res = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Something went wrong.');
  return body;
}

const apiPost = (url, data) => apiSend('POST', url, data);
const apiPut = (url, data) => apiSend('PUT', url, data);
const apiDelete = (url) => apiSend('DELETE', url);

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDate(iso) {
  return new Date(iso).toLocaleString();
}

// ---------------------------------------------------------------------------
// Toast notifications
// ---------------------------------------------------------------------------
function getToastStack() {
  let stack = document.getElementById('toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'toast-stack';
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }
  return stack;
}

function showToast(message, type = 'success', timeout = 3200) {
  const stack = getToastStack();
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.innerHTML = `<span class="toast__icon">${type === 'success' ? '✓' : '!'}</span><span>${escapeHtml(message)}</span>`;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .2s ease, transform .2s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    setTimeout(() => el.remove(), 200);
  }, timeout);
}

async function initPage(requiredRole) {
  let me = null;
  try { me = (await apiGet('/api/me')).user; } catch { me = null; }

  if (!me && requiredRole !== 'guest') { window.location.href = '/login.html'; return null; }
  if (me && requiredRole === 'guest') { window.location.href = me.role === 'admin' ? '/admin.html' : '/index.html'; return null; }
  if (me && requiredRole && requiredRole !== 'guest' && me.role !== requiredRole) { window.location.href = me.role === 'admin' ? '/admin.html' : '/index.html'; return null; }

  const headerEl = document.getElementById('site-header');
  if (headerEl) {
    headerEl.innerHTML = renderHeader(me);
    const logoutLink = document.getElementById('logout-link');
    if (logoutLink) {
      logoutLink.addEventListener('click', async (e) => {
        e.preventDefault();
        await apiPost('/api/logout');
        window.location.href = '/login.html';
      });
    }
  }
  return me;
}

function renderHeader(me) {
  const homeHref = me ? (me.role === 'admin' ? '/admin.html' : '/index.html') : '/login.html';
  const navLinks = !me ? '' : (me.role === 'admin'
    ? `<a href="/admin.html" class="nav__link">Dashboard</a>
       <a href="/admin-subjects.html" class="nav__link">Subjects</a>
       <a href="/admin-questions.html" class="nav__link">Question Bank</a>
       <a href="/admin-mcq-sets.html" class="nav__link">MCQ Sets</a>
       <a href="/admin-exams.html" class="nav__link">Exams</a>`
    : `<a href="/index.html" class="nav__link">Exams</a>
       <a href="/mcq-practice.html" class="nav__link">MCQ Practice</a>
       <a href="/results.html" class="nav__link">My Results</a>`);

  return `
    <div class="site-header__inner">
      <a class="brand" href="${homeHref}"><span class="brand__mark">Ex</span><span class="brand__text">amHall</span></a>
      ${me ? `<nav class="nav">${navLinks}<a href="#" class="nav__link nav__link--logout" id="logout-link">Log out</a></nav>` : ''}
    </div>
    ${me ? `<div class="site-header__user-row"><span class="nav__user">${escapeHtml(me.name)} <em>· ${me.role}</em></span></div>` : ''}
  `;
}
