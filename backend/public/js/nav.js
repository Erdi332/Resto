(function () {
  const PAGE_ROLES = {
    'index.html': ['admin', 'serveur', 'cuisine'],
    'dishes.html': ['admin', 'cuisine'],
    'ingredients.html': ['admin', 'cuisine'],
    'sales.html': ['admin', 'serveur'],
    'purchases.html': ['admin', 'cuisine'],
    'stock-history.html': ['admin', 'cuisine'],
    'tracking.html': ['admin'],
    'users.html': ['admin'],
  };

  function applyNavVisibility(effectiveRole) {
    document.querySelectorAll('.nav-rail li').forEach((li) => {
      const a = li.querySelector('a');
      if (!a) return;
      const page = a.getAttribute('href');
      const allowed = PAGE_ROLES[page];
      li.style.display = !allowed || allowed.includes(effectiveRole) ? '' : 'none';
    });
  }

  async function initNav() {
    let user;
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) {
        window.location.href = '/login.html';
        return;
      }
      user = await res.json();
    } catch (e) {
      window.location.href = '/login.html';
      return;
    }

    const footer = document.querySelector('#sidebar-footer');
    if (!footer) return;

    let viewRole = user.role;
    let toggleHtml = '';

    if (user.role === 'admin') {
      toggleHtml = `
        <div class="view-toggle">
          <label for="view-toggle-select">View as</label>
          <select id="view-toggle-select">
            <option value="admin">Admin (all)</option>
            <option value="serveur">Server</option>
            <option value="cuisine">Kitchen</option>
          </select>
        </div>
      `;
    }

    footer.innerHTML = `
      ${toggleHtml}
      <div class="sidebar-user">
        <div class="sidebar-user-name">${user.username}</div>
        <div class="sidebar-user-role">${user.role}</div>
      </div>
      <button type="button" id="logout-btn" class="btn btn-ghost btn-small logout-btn">Logout</button>
    `;

    if (user.role === 'admin') {
      viewRole = localStorage.getItem('kitchenops-view-role') || 'admin';
      const select = document.querySelector('#view-toggle-select');
      select.value = viewRole;
      select.addEventListener('change', (e) => {
        viewRole = e.target.value;
        localStorage.setItem('kitchenops-view-role', viewRole);
        applyNavVisibility(viewRole);
      });
    }

    applyNavVisibility(viewRole);

    document.querySelector('#logout-btn').addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login.html';
    });
  }

  initNav();
})();
