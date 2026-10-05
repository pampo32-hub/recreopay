// RECREOPAY - LÓGICA DE CLIENTE PWA (AUTENTICACIÓN, ADMIN, ESTUDIANTES Y PADRES)

let currentUser = null;
let currentStudent = null;
let students = [];
let categories = [];
let products = [];
let activeCategoryId = null;
let cart = [];
let currentAppMode = 'teens';
let adminProducts = [];
let adminStats = null;
let adminSearchQuery = '';

let CLOUDFLARE_TUNNEL_URL = 'https://recreopay.gammapos.app';

function checkHttpsEnvironment() {
  const isHttp = window.location.protocol !== 'https:' && 
                 window.location.hostname !== 'localhost' && 
                 window.location.hostname !== '127.0.0.1';
  
  if (isHttp) {
    const banner = document.getElementById('bannerHttpsWarning');
    if (banner) {
      banner.style.display = 'block';
      const link = document.getElementById('linkHttpsRedirect');
      if (link) {
        link.href = CLOUDFLARE_TUNNEL_URL + window.location.pathname;
      }
    }
  }

  fetch('/api/server-info')
    .then(r => r.json())
    .then(info => {
      if (info && info.tunnelUrl) {
        CLOUDFLARE_TUNNEL_URL = info.tunnelUrl;
        const link = document.getElementById('linkHttpsRedirect');
        if (link && isHttp) {
          link.href = CLOUDFLARE_TUNNEL_URL + window.location.pathname;
        }
      }
    })
    .catch(() => {});
}

// Inicialización al cargar la página
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  checkHttpsEnvironment();

  // Registrar Service Worker para PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js?v=8.1').then(reg => {
      // Registro limpio sin recargas forzadas
    }).catch(err => console.log('SW error:', err));
  }

  // Verificar si hay sesión activa guardada
  const storedUser = localStorage.getItem('recreopay_user');
  if (storedUser) {
    try {
      currentUser = JSON.parse(storedUser);
    } catch (e) {
      currentUser = null;
    }
  }

  if (!currentUser) {
    // Mostrar pantalla de Login limpia (NO auto-login)
    showLoginView();
  } else {
    await applyUserRoleSession();
  }

  initStudentSSE();
});

// ==========================================
// VISTA Y MANEJO DE AUTENTICACIÓN / SESIÓN
// ==========================================

let currentParentChild = null; // Estudiante activo en el portal de padres
let adminSelectedStudent = null; // Estudiante seleccionado para recarga en admin
let scanChildStream = null;
let scanChildAnimId = null;
let scanAdminStream = null;
let scanAdminAnimId = null;

function showLoginView() {
  const viewLogin = document.getElementById('viewLogin');
  const viewAdmin = document.getElementById('viewAdmin');
  const viewPadres = document.getElementById('viewPadres');
  const appContainer = document.getElementById('appContainer');
  const bottomNav = document.getElementById('pwaBottomNav');

  if (viewLogin) viewLogin.style.display = 'flex';
  if (viewAdmin) viewAdmin.style.display = 'none';
  if (viewPadres) viewPadres.style.display = 'none';
  if (appContainer) appContainer.style.display = 'none';
  if (bottomNav) bottomNav.style.display = 'none';

  switchLoginTab('login');
  closeScanChildQrModal();
  closeAdminScanQrModal();
  toggleParentPanel(false);
  closeCartModal();
  closeQrModal();
  closeTransferModal();
}

function switchLoginTab(tab) {
  const formLogin = document.getElementById('formLogin');
  const formRegister = document.getElementById('formRegisterPadre');
  const tabLogin = document.getElementById('tabBtnLogin');
  const tabReg = document.getElementById('tabBtnRegister');
  const demoBox = document.querySelector('.login-demo-box');

  if (tab === 'login') {
    if (formLogin) formLogin.style.display = 'block';
    if (formRegister) formRegister.style.display = 'none';
    if (tabLogin) tabLogin.classList.add('active');
    if (tabReg) tabReg.classList.remove('active');
    if (demoBox) demoBox.style.display = 'block';
  } else {
    if (formLogin) formLogin.style.display = 'none';
    if (formRegister) formRegister.style.display = 'block';
    if (tabLogin) tabLogin.classList.remove('active');
    if (tabReg) tabReg.classList.add('active');
    if (demoBox) demoBox.style.display = 'none';
  }
}

async function handleRegisterPadreSubmit(event) {
  if (event) event.preventDefault();
  const nombre = document.getElementById('regNombre').value.trim();
  const telefono = document.getElementById('regTelefono').value.trim();
  const username = document.getElementById('regUsername').value.trim();
  const password = document.getElementById('regPassword').value.trim();
  const errorMsg = document.getElementById('registerErrorMsg');
  const btnSubmit = document.getElementById('btnRegisterSubmit');

  if (errorMsg) errorMsg.style.display = 'none';
  btnSubmit.disabled = true;
  btnSubmit.textContent = 'Creando cuenta de padre...';

  try {
    const res = await fetch('/api/auth/register-padre', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, telefono, username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al registrar la cuenta');

    currentUser = {
      ...data.user,
      hijos: []
    };
    localStorage.setItem('recreopay_user', JSON.stringify(currentUser));

    if (window.sounds) window.sounds.playSuccess();
    alert(`🎉 ¡Bienvenido(a) a RecreoPay, ${data.user.nombre}! Tu cuenta de padre fue creada exitosamente.`);
    await applyUserRoleSession();
  } catch (err) {
    if (errorMsg) {
      errorMsg.textContent = `❌ ${err.message}`;
      errorMsg.style.display = 'block';
    }
    if (window.sounds) window.sounds.playError();
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerHTML = '✨ Crear Cuenta y Entrar al Panel';
  }
}

function quickFillLogin(username, password) {
  document.getElementById('loginUsername').value = username;
  document.getElementById('loginPassword').value = password;
  handleLoginSubmit();
}

async function handleLoginSubmit(event) {
  if (event) event.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value.trim();
  const errorMsg = document.getElementById('loginErrorMsg');
  const submitBtn = document.getElementById('btnLoginSubmit');

  if (!username || !password) {
    if (errorMsg) {
      errorMsg.textContent = 'Por favor ingresa tu usuario y contraseña';
      errorMsg.style.display = 'block';
    }
    return;
  }

  if (errorMsg) errorMsg.style.display = 'none';
  submitBtn.disabled = true;
  submitBtn.textContent = 'Verificando credenciales...';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Credenciales incorrectas');
    }

    currentUser = {
      ...data.user,
      estudiante: data.estudiante,
      hijos: data.hijos || []
    };
    localStorage.setItem('recreopay_user', JSON.stringify(currentUser));

    if (window.sounds) window.sounds.playSuccess();
    await applyUserRoleSession();
  } catch (err) {
    if (errorMsg) {
      errorMsg.textContent = `❌ ${err.message}`;
      errorMsg.style.display = 'block';
    }
    if (window.sounds) window.sounds.playError();
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '🚀 Iniciar Sesión';
  }
}

async function applyUserRoleSession() {
  if (!currentUser) return showLoginView();

  const viewLogin = document.getElementById('viewLogin');
  const viewAdmin = document.getElementById('viewAdmin');
  const viewPadres = document.getElementById('viewPadres');
  const appContainer = document.getElementById('appContainer');
  const bottomNav = document.getElementById('pwaBottomNav');
  const navPadres = document.getElementById('pwaNavPadres');

  if (viewLogin) viewLogin.style.display = 'none';

  if (currentUser.rol === 'admin' || currentUser.rol === 'cajero') {
    if (viewAdmin) viewAdmin.style.display = 'block';
    if (viewPadres) viewPadres.style.display = 'none';
    if (appContainer) appContainer.style.display = 'none';
    if (bottomNav) bottomNav.style.display = 'none';
    const adminNameEl = document.getElementById('adminLoggedName');
    if (adminNameEl) {
      const badgeRol = currentUser.rol === 'cajero' ? 'Cajero Soda' : 'Administrador';
      adminNameEl.textContent = `${currentUser.nombre} (${badgeRol})`;
    }
    await loadAdminData();
    setupAdminSmartSearch();
  } else if (currentUser.rol === 'padre') {
    if (viewAdmin) viewAdmin.style.display = 'none';
    if (viewPadres) viewPadres.style.display = 'block'; // PANEL DEDICADO COMPLETO (NO MODAL)
    if (appContainer) appContainer.style.display = 'none';
    if (bottomNav) bottomNav.style.display = 'none';
    
    await loadInitialData();
    await loadParentDashboard();
  } else {
    // Estudiante: SEGURIDAD ESTRICTA - Ocultar botón de padres
    if (viewAdmin) viewAdmin.style.display = 'none';
    if (viewPadres) viewPadres.style.display = 'none';
    if (appContainer) appContainer.style.display = 'block';
    if (bottomNav) bottomNav.style.display = 'flex';
    if (navPadres) navPadres.style.display = 'none'; // Estudiantes no ven pestaña padres

    const btnPadres = document.getElementById('btnModePadres');
    if (btnPadres) btnPadres.style.display = 'none';
    
    await loadInitialData();
    if (currentUser.estudiante) {
      await selectStudent(currentUser.estudiante.id);
    } else if (students.length > 0) {
      await selectStudent(students[0].id);
    }
  }
}

function logout(skipConfirm = false) {
  if (skipConfirm || confirm('¿Deseas cerrar sesión para seleccionar otra cuenta?')) {
    localStorage.removeItem('recreopay_user');
    currentUser = null;
    currentStudent = null;
    currentParentChild = null;
    adminSelectedStudent = null;
    showLoginView();
    if (window.sounds) window.sounds.playTap();
  }
}

// Navegación PWA móvil con barra inferior
function pwaNavigateTo(target) {
  document.querySelectorAll('.pwa-nav-item').forEach(b => b.classList.remove('active'));

  if (target === 'menu') {
    const btn = document.getElementById('pwaNavMenu');
    if (btn) btn.classList.add('active');
    closeQrModal();
    closeTransferModal();
    toggleParentPanel(false);
    closeCartModal();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (target === 'qr') {
    const btn = document.getElementById('pwaNavQr');
    if (btn) btn.classList.add('active');
    closeTransferModal();
    toggleParentPanel(false);
    openQrModal();
  } else if (target === 'transfer') {
    const btn = document.getElementById('pwaNavTransfer');
    if (btn) btn.classList.add('active');
    closeQrModal();
    toggleParentPanel(false);
    openTransferModal();
  } else if (target === 'padres') {
    const btn = document.getElementById('pwaNavPadres');
    if (btn) btn.classList.add('active');
    closeQrModal();
    closeTransferModal();
    toggleParentPanel(true);
  }
}

async function loadInitialData() {
  try {
    // 1. Cargar estudiantes
    const resEst = await fetch('/api/estudiantes');
    students = await resEst.json();

    populateStudentSelector();

    // 2. Cargar productos y categorías
    const resProd = await fetch('/api/productos');
    const dataProd = await resProd.json();
    categories = dataProd.categorias;
    products = dataProd.productos;

    renderCategories();
    renderProducts();
  } catch (error) {
    console.error('Error cargando datos iniciales:', error);
  }
}

function populateStudentSelector() {
  const sel = document.getElementById('studentSelector');
  if (!sel) return;
  sel.innerHTML = students.map(s => `
    <option value="${s.id}">
      ${s.nombre_completo} (${s.edad} años - ${s.grado})
    </option>
  `).join('');
}

async function onStudentChange(studentId) {
  await selectStudent(studentId);
}

async function selectStudent(studentId) {
  try {
    const res = await fetch(`/api/estudiantes/${studentId}`);
    currentStudent = await res.json();
    currentAppMode = 'teens';
    updateStudentUI();
  } catch (e) {
    console.error('Error seleccionando estudiante:', e);
  }
}

function updateStudentUI() {
  if (!currentStudent) return;

  // Actualizar avatar, nombre y grado
  document.getElementById('walletAvatar').src = currentStudent.foto_url || 'https://api.dicebear.com/7.x/bottts/svg?seed=est';
  document.getElementById('walletName').textContent = currentStudent.nombre_completo;
  document.getElementById('walletGrade').textContent = `${currentStudent.grado} • Sección ${currentStudent.seccion} • Cód: ${currentStudent.codigo_estudiante}`;

  // Saldo en colones
  document.getElementById('walletBalance').textContent = `₡${currentStudent.saldo_colones.toLocaleString('es-CR')}`;
  document.getElementById('balanceLabel').textContent = 'SALDO DISPONIBLE';
  const coin = document.getElementById('kidsCoinIcon');
  if (coin) coin.style.display = 'none';
  const qrBtn = document.getElementById('qrBtnText');
  if (qrBtn) qrBtn.textContent = 'Mi QR';
  const transferBtn = document.getElementById('transferBtnText');
  if (transferBtn) transferBtn.textContent = 'Transferir ⚡';

  // Límite diario y disponible hoy
  const limiteDiario = currentStudent.limite_diario_colones || 0;
  const gastadoHoy = currentStudent.gastado_hoy || 0;
  const disponibleHoy = (typeof currentStudent.disponible_hoy === 'number')
    ? currentStudent.disponible_hoy
    : Math.max(0, limiteDiario - gastadoHoy);

  document.getElementById('dailyLimitText').textContent = `₡${limiteDiario.toLocaleString('es-CR')}`;
  document.getElementById('dailyAvailableText').textContent = `Disponible hoy: ₡${disponibleHoy.toLocaleString('es-CR')}`;

  // Alerta de Tarjeta Bloqueada
  const bannerBlocked = document.getElementById('bannerCardBlocked');
  if (bannerBlocked) {
    bannerBlocked.style.display = currentStudent.tarjeta_bloqueada ? 'flex' : 'none';
  }
  document.querySelectorAll('.qr-toggle-btn').forEach(btn => {
    if (currentStudent.tarjeta_bloqueada) {
      btn.style.opacity = '0.45';
      btn.style.pointerEvents = 'none';
    } else {
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
    }
  });

  // Alergias
  const allergyBox = document.getElementById('allergyWarning');
  if (currentStudent.alergias && currentStudent.alergias !== 'Ninguna' && currentStudent.alergias !== 'Ninguna conocida') {
    allergyBox.style.display = 'flex';
    document.getElementById('allergyText').textContent = currentStudent.alergias;
  } else {
    allergyBox.style.display = 'none';
  }

  // QR Modal info
  document.getElementById('qrDisplayImg').src = `/api/qr-image/${encodeURIComponent(currentStudent.qr_token)}`;
  document.getElementById('qrTokenDisplay').textContent = currentStudent.qr_token;

  // Panel de Padres sliders y valores
  document.getElementById('lblParentDailyLimit').textContent = `₡${currentStudent.limite_diario_colones.toLocaleString('es-CR')}`;
  document.getElementById('rangeDailyLimit').value = currentStudent.limite_diario_colones;
  const inputWrittenLimit = document.getElementById('inputCustomDailyLimit');
  if (inputWrittenLimit) {
    inputWrittenLimit.value = currentStudent.limite_diario_colones;
  }
  
  const chkTransfer = document.getElementById('chkParentAllowTransfer');
  if (chkTransfer) {
    chkTransfer.checked = currentStudent.permitir_transferencias !== 0;
  }

  renderParentHistory();
}

function setAppMode(mode, playSound = false) {
  currentAppMode = 'teens';
}

function initTheme() {
  const saved = localStorage.getItem('recreopay_theme') || 'light';
  const btn = document.getElementById('btnThemeToggle');
  if (saved === 'dark') {
    document.body.classList.add('dark-mode');
    if (btn) btn.textContent = '☀️';
  } else {
    document.body.classList.remove('dark-mode');
    if (btn) btn.textContent = '🌙';
  }
}

function toggleTheme() {
  const isDark = document.body.classList.toggle('dark-mode');
  const btn = document.getElementById('btnThemeToggle');
  if (isDark) {
    if (btn) btn.textContent = '☀️';
    localStorage.setItem('recreopay_theme', 'dark');
  } else {
    if (btn) btn.textContent = '🌙';
    localStorage.setItem('recreopay_theme', 'light');
  }
  if (window.sounds) window.sounds.playTap();
}

// Renderizado de Categorías
function renderCategories() {
  const bar = document.getElementById('categoriesBar');
  if (!bar) return;
  let html = `
    <button class="cat-pill ${activeCategoryId === null ? 'active' : ''}" onclick="selectCategory(null)">
      <span>✨</span> Todos
    </button>
  `;

  for (const cat of categories) {
    html += `
      <button class="cat-pill ${activeCategoryId === cat.id ? 'active' : ''}" onclick="selectCategory(${cat.id})">
        <span>${cat.icono}</span> ${cat.nombre}
      </button>
    `;
  }
  bar.innerHTML = html;
}

function selectCategory(catId) {
  activeCategoryId = catId;
  renderCategories();
  renderProducts();
}

// Renderizado de Productos del Menú (Con soporte para Agotado / Greyed Out)
function renderProducts() {
  const grid = document.getElementById('productsGrid');
  if (!grid) return;
  const filterMepOnly = document.getElementById('chkFilterMep')?.checked || false;

  let filtered = products;

  if (activeCategoryId !== null) {
    filtered = filtered.filter(p => p.categoria_id === activeCategoryId);
  }

  if (filterMepOnly) {
    filtered = filtered.filter(p => p.cumple_mep === 1);
  }

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 30px; color: var(--text-muted);">
        <p style="font-size: 2rem;">🥪</p>
        <p>No hay productos en esta categoría por ahora.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map(prod => {
    const isOutOfStock = prod.control_stock === 1 && (prod.stock <= 0 || prod.disponible === 0);
    const stockBadge = (prod.control_stock === 1 && isOutOfStock)
      ? '<span class="badge-out-of-stock">🚫 AGOTADO</span>'
      : '';

    return `
      <div class="product-card ${isOutOfStock ? 'out-of-stock' : ''}">
        <div class="product-icon-wrap">${prod.icono || '🥪'}</div>
        <div>
          <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 4px;">
            ${prod.cumple_mep ? '<span class="badge-mep">🌿 MEP Saludable</span>' : ''}
            ${stockBadge}
          </div>
          <h4 class="product-name">${prod.nombre}</h4>
          <p class="product-desc">${prod.descripcion || ''}</p>
          ${prod.alergenos ? `<div style="font-size: 0.68rem; color: #dc2626; margin-bottom: 4px;">⚠️ Contiene: ${prod.alergenos}</div>` : ''}
        </div>
        <div class="product-footer">
          <span class="product-price">₡${prod.precio_colones.toLocaleString('es-CR')}</span>
          ${isOutOfStock ? `
            <button class="add-btn" disabled style="opacity: 0.5; background: #94a3b8; cursor: not-allowed;" title="Producto Agotado">
              🚫
            </button>
          ` : `
            <button class="add-btn" onclick="addToCart(${prod.id})" title="Agregar a mi pre-orden">
              +
            </button>
          `}
        </div>
      </div>
    `;
  }).join('');
}

// ==========================================
// CARRITO Y PRE-ÓRDENES
// ==========================================

function addToCart(productId) {
  const prod = products.find(p => p.id === productId);
  if (!prod) return;

  if (prod.control_stock === 1 && (prod.stock <= 0 || prod.disponible === 0)) {
    alert(`⚠️ El producto "${prod.nombre}" se encuentra agotado en la soda.`);
    return;
  }

  const existing = cart.find(item => item.product.id === productId);
  const currentInCart = existing ? existing.cantidad : 0;
  if (prod.control_stock === 1 && (currentInCart + 1) > prod.stock) {
    alert(`⚠️ Solo quedan ${prod.stock} unidad(es) de "${prod.nombre}" en inventario.`);
    return;
  }

  if (existing) {
    existing.cantidad++;
  } else {
    cart.push({ product: prod, cantidad: 1 });
  }

  if (window.sounds) {
    window.sounds.playCoin();
  }

  updateCartBar();
}

function updateCartBar() {
  const bar = document.getElementById('floatingCart');
  const countBadge = document.getElementById('cartCountBadge');
  const totalText = document.getElementById('cartTotalText');

  const totalCount = cart.reduce((sum, item) => sum + item.cantidad, 0);
  const totalColones = cart.reduce((sum, item) => sum + (item.product.precio_colones * item.cantidad), 0);

  if (totalCount > 0) {
    bar.style.display = 'flex';
    countBadge.textContent = `${totalCount} ${totalCount === 1 ? 'ítem' : 'ítems'}`;
    totalText.textContent = `₡${totalColones.toLocaleString('es-CR')}`;
  } else {
    bar.style.display = 'none';
  }
}

function openCartModal() {
  renderCartModalItems();
  document.getElementById('modalCart').style.display = 'flex';
}

function closeCartModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('modalCart').style.display = 'none';
}

function renderCartModalItems() {
  const list = document.getElementById('cartItemsList');
  const totalEl = document.getElementById('modalCartTotal');

  if (cart.length === 0) {
    list.innerHTML = '<p style="text-align: center; color: #94a3b8; padding: 20px;">El carrito está vacío</p>';
    totalEl.textContent = '₡0';
    return;
  }

  let total = 0;
  list.innerHTML = cart.map((item, idx) => {
    const subtotal = item.product.precio_colones * item.cantidad;
    total += subtotal;
    return `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #f1f5f9;">
        <div>
          <strong style="font-size: 0.9rem; color: #0f172a;">${item.product.icono} ${item.product.nombre}</strong>
          <div style="font-size: 0.75rem; color: #64748b;">₡${item.product.precio_colones.toLocaleString('es-CR')} c/u</div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <button onclick="changeCartQty(${idx}, -1)" style="width: 28px; height: 28px; border-radius: 6px; border: 1px solid #cbd5e1; background: white; font-weight: 800; cursor: pointer;">-</button>
          <span style="font-weight: 800; font-size: 0.9rem; min-width: 16px; text-align: center;">${item.cantidad}</span>
          <button onclick="changeCartQty(${idx}, 1)" style="width: 28px; height: 28px; border-radius: 6px; border: 1px solid #cbd5e1; background: white; font-weight: 800; cursor: pointer;">+</button>
          <span style="font-weight: 900; font-size: 0.95rem; color: #0284c7; min-width: 65px; text-align: right;">₡${subtotal.toLocaleString('es-CR')}</span>
        </div>
      </div>
    `;
  }).join('');

  totalEl.textContent = `₡${total.toLocaleString('es-CR')}`;
}

function changeCartQty(index, delta) {
  cart[index].cantidad += delta;
  if (cart[index].cantidad <= 0) {
    cart.splice(index, 1);
  }
  renderCartModalItems();
  updateCartBar();
}

async function submitPreOrder() {
  if (!currentStudent) return;
  if (cart.length === 0) return alert('Agrega al menos un producto a tu pre-orden');

  const momento = document.getElementById('momentoEntregaSelect').value;
  const items = cart.map(item => ({
    producto_id: item.product.id,
    cantidad: item.cantidad
  }));

  const btn = document.getElementById('btnConfirmarOrden');
  btn.disabled = true;
  btn.textContent = 'Procesando en la soda...';

  try {
    const res = await fetch('/api/ordenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        estudiante_id: currentStudent.id,
        tipo_orden: 'preorden',
        momento_entrega: momento,
        items
      })
    });

    const data = await res.json();
    if (!res.ok) {
      if (window.sounds) window.sounds.playError();
      throw new Error(data.error || 'Error procesando pre-orden');
    }

    if (window.sounds) window.sounds.playSuccess();

    alert(`🎉 ¡Pre-Orden confirmada con éxito!\nCódigo de entrega: ${data.codigo_orden}\nRebajada de tu monedero: ₡${data.total_colones.toLocaleString('es-CR')}\n\nPodrás retirarla en la fila rápida de la soda durante el recreo presentando tu QR.`);

    // Limpiar carrito y recargar datos del estudiante
    cart = [];
    updateCartBar();
    closeCartModal();
    await selectStudent(currentStudent.id);
  } catch (err) {
    alert(`❌ No se pudo procesar: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '✅ Confirmar y Pagar Pre-Orden';
  }
}

// ==========================================
// MODAL QR ESCOLAR
// ==========================================

function openQrModal() {
  if (window.sounds) window.sounds.playScanChirp();
  document.getElementById('modalQr').style.display = 'flex';
}

function resetPwaNavActive() {
  const menuBtn = document.getElementById('pwaNavMenu');
  if (menuBtn) {
    document.querySelectorAll('.pwa-nav-item').forEach(b => b.classList.remove('active'));
    menuBtn.classList.add('active');
  }
}

function closeQrModal(e) {
  if (e && e.target !== e.currentTarget) return;
  const modal = document.getElementById('modalQr');
  if (modal) modal.style.display = 'none';
  resetPwaNavActive();
}

// ==========================================
// PANEL DE PADRES Y RECARGAS SINPE
// ==========================================

function toggleParentPanel(show, e) {
  if (e && e.target !== e.currentTarget) return;
  if (currentUser && currentUser.rol === 'padre') {
    if (show) {
      returnToParentDashboard();
    } else {
      switchToSodaMenuAsParent();
    }
    return;
  }
  // SEGURIDAD: Un estudiante no tiene acceso al portal de padres
  const modalPadres = document.getElementById('modalPadres');
  if (modalPadres) modalPadres.style.display = 'none';
  resetPwaNavActive();
}

function openDailyLimitEditor() {
  // SEGURIDAD: Los estudiantes no pueden modificar su límite diario
  if (!currentUser || currentUser.rol === 'estudiante') {
    return;
  }
  toggleParentPanel(true);
  setTimeout(() => {
    const input = document.getElementById('inputCustomDailyLimit');
    if (input) {
      input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      input.focus();
      input.select();
    }
  }, 200);
}

function setWrittenRechargeAmount(monto) {
  const input = document.getElementById('inputCustomSinpe');
  if (input) {
    input.value = monto;
    input.focus();
  }
  if (window.sounds) window.sounds.playCoin();
}

async function quickSinpeRecharge(monto) {
  await doSinpeRecharge(monto);
}

async function customSinpeRecharge() {
  const input = document.getElementById('inputCustomSinpe');
  const val = parseInt(input.value, 10);
  if (!val || val <= 0) return alert('Por favor escribe un monto válido a recargar en colones.');
  await doSinpeRecharge(val);
  input.value = '';
}

async function doSinpeRecharge(monto) {
  if (!currentStudent) return;
  const comprobante = `SINPE-${Math.floor(100000 + Math.random() * 900000)}`;

  try {
    const res = await fetch(`/api/estudiantes/${currentStudent.id}/recarga`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        monto,
        comprobante,
        descripcion: `Recarga SINPE Móvil desde portal de padres`
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (window.sounds) window.sounds.playSuccess();
    alert(`✅ ¡Recarga SINPE exitosa!\nSe acreditaron ₡${monto.toLocaleString('es-CR')} al monedero de ${currentStudent.nombre_completo}.\nComprobante: ${comprobante}`);

    await selectStudent(currentStudent.id);
  } catch (err) {
    alert(`Error en recarga: ${err.message}`);
  }
}

// ==========================================
// CONTROL DE LÍMITE DIARIO ESCRITO Y SLIDER
// ==========================================

function onCustomDailyLimitInput(val) {
  const num = parseInt(val, 10);
  if (!isNaN(num) && num >= 0) {
    document.getElementById('lblParentDailyLimit').textContent = `₡${num.toLocaleString('es-CR')}`;
    const slider = document.getElementById('rangeDailyLimit');
    if (slider && num >= 1000 && num <= 10000) {
      slider.value = num;
    }
  }
}

async function setWrittenDailyLimit(val) {
  const input = document.getElementById('inputCustomDailyLimit');
  if (input) input.value = val;
  onCustomDailyLimitInput(val);
  await saveCustomDailyLimit(val);
}

async function saveCustomDailyLimit(customVal) {
  let val = customVal;
  if (val === undefined) {
    const input = document.getElementById('inputCustomDailyLimit');
    val = parseInt(input.value, 10);
  }

  if (isNaN(val) || val < 0) {
    return alert('Por favor escribe un monto válido para el límite diario.');
  }

  if (!currentStudent) return;

  try {
    const res = await fetch(`/api/estudiantes/${currentStudent.id}/limite`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limite_diario_colones: val })
    });

    if (res.ok) {
      currentStudent.limite_diario_colones = val;
      document.getElementById('lblParentDailyLimit').textContent = `₡${val.toLocaleString('es-CR')}`;
      document.getElementById('dailyLimitText').textContent = `₡${val.toLocaleString('es-CR')}`;

      const slider = document.getElementById('rangeDailyLimit');
      if (slider && val >= 1000 && val <= 10000) {
        slider.value = val;
      }

      const input = document.getElementById('inputCustomDailyLimit');
      if (input) input.value = val;

      const fb = document.getElementById('msgDailyLimitFeedback');
      if (fb) {
        fb.textContent = `✅ ¡Límite fijado en ₡${val.toLocaleString('es-CR')} con éxito!`;
        fb.style.display = 'block';
        setTimeout(() => { if (fb) fb.style.display = 'none'; }, 4000);
      }

      if (window.sounds) window.sounds.playSuccess();
      await selectStudent(currentStudent.id);
    }
  } catch (e) {
    alert('Error guardando el límite diario: ' + e.message);
  }
}

async function onDailyLimitSlider(val) {
  const num = parseInt(val, 10);
  document.getElementById('lblParentDailyLimit').textContent = `₡${num.toLocaleString('es-CR')}`;
  
  const input = document.getElementById('inputCustomDailyLimit');
  if (input) input.value = num;

  if (!currentStudent) return;

  try {
    await fetch(`/api/estudiantes/${currentStudent.id}/limite`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limite_diario_colones: num })
    });
    currentStudent.limite_diario_colones = num;
    document.getElementById('dailyLimitText').textContent = `₡${currentStudent.limite_diario_colones.toLocaleString('es-CR')}`;
  } catch (e) {}
}

function renderParentHistory() {
  const container = document.getElementById('parentHistoryList');
  if (!currentStudent || !currentStudent.transacciones || currentStudent.transacciones.length === 0) {
    container.innerHTML = '<p style="color: #94a3b8;">Sin movimientos recientes</p>';
    return;
  }

  container.innerHTML = currentStudent.transacciones.map(t => {
    const esPositivo = t.monto_colones > 0;
    const color = esPositivo ? '#166534' : '#0f172a';
    const signo = esPositivo ? '+' : '';
    const fecha = new Date(t.fecha).toLocaleDateString('es-CR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    return `
      <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f1f5f9;">
        <div>
          <div style="font-weight: 700; color: ${color};">${t.descripcion || t.tipo}</div>
          <div style="font-size: 0.7rem; color: #94a3b8;">${fecha}</div>
        </div>
        <div style="font-weight: 800; color: ${esPositivo ? '#10b981' : '#ef4444'};">
          ${signo}₡${Math.abs(t.monto_colones).toLocaleString('es-CR')}
        </div>
      </div>
    `;
  }).join('');
}

// ==========================================
// RECREOTRANSFER: PASAR PLATA A UN COMPAÑERO (OPCIÓN 2: ESCANEAR AL AMIGO)
// ==========================================

let selectedTransferTarget = null;
let currentTransferAmount = 500;
let transferVideoStream = null;
let isTransferScanning = false;

function openTransferModal() {
  if (!currentStudent) return;

  if (currentStudent.permitir_transferencias === 0) {
    if (window.sounds) window.sounds.playError();
    return alert('⚠️ Tus padres tienen desactivadas las transferencias entre compañeros en tu perfil.');
  }

  if (window.sounds) window.sounds.playCoin();
  document.getElementById('modalTransfer').style.display = 'flex';
  resetTransferScan();
  renderQuickTransferFriends();
}

function closeTransferModal(e) {
  if (e && e.target !== e.currentTarget) return;
  stopTransferCamera();
  const modal = document.getElementById('modalTransfer');
  if (modal) modal.style.display = 'none';
  resetPwaNavActive();
}

function renderQuickTransferFriends() {
  const container = document.getElementById('quickTransferFriends');
  const others = students.filter(s => s.id !== currentStudent.id);

  container.innerHTML = others.map(s => `
    <button type="button" onclick="selectTransferTargetById(${s.id})" style="display: flex; align-items: center; gap: 4px; padding: 4px 8px; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.72rem; font-weight: 700; cursor: pointer; color: #1e293b;">
      <img src="${s.foto_url}" style="width: 20px; height: 20px; border-radius: 50%;">
      <span>${s.nombre_completo.split(' ')[0]} (${s.grado.split(' ')[0]})</span>
    </button>
  `).join('');
}

function selectTransferTargetById(studentId) {
  const target = students.find(s => s.id === studentId);
  if (!target) return;
  onTransferTargetIdentified(target);
}

function onTransferTargetIdentified(target) {
  selectedTransferTarget = target;
  stopTransferCamera();

  if (window.sounds) window.sounds.playScanChirp();

  document.getElementById('transferTargetAvatar').src = target.foto_url;
  document.getElementById('transferTargetName').textContent = target.nombre_completo;
  document.getElementById('transferTargetGrade').textContent = `${target.grado} • Sección ${target.seccion} • Cód: ${target.codigo_estudiante}`;

  // Resetear montos y PIN
  setTransferAmount(500, document.getElementById('btnTransfer500'));
  document.getElementById('inputTransferCustomAmount').value = '';
  document.getElementById('inputTransferMotivo').value = '';
  const pinInput = document.getElementById('inputTransferPin');
  if (pinInput) {
    pinInput.value = '';
    pinInput.type = 'password';
  }
  const pinHint = document.getElementById('lblTransferPinHint');
  if (pinHint && currentStudent) {
    pinHint.textContent = `(PIN: ${currentStudent.pin_seguridad || '1234'})`;
  }

  document.getElementById('transferStepScan').style.display = 'none';
  document.getElementById('transferStepConfirm').style.display = 'block';
}

function resetTransferScan() {
  selectedTransferTarget = null;
  document.getElementById('transferStepConfirm').style.display = 'none';
  document.getElementById('transferStepScan').style.display = 'block';
  startTransferCamera();
}

function setTransferAmount(val, btn) {
  currentTransferAmount = val;
  document.querySelectorAll('#transferStepConfirm .mode-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('inputTransferCustomAmount').value = '';
  if (window.sounds) window.sounds.playCoin();
}

// Control del Teclado Numérico Táctil del PIN
function appendPinDigit(digit) {
  const pinInput = document.getElementById('inputTransferPin');
  if (!pinInput) return;
  if (pinInput.value.length < 4) {
    pinInput.value += digit;
    if (window.sounds) window.sounds.playCoin();
  }
}

function backspacePinDigit() {
  const pinInput = document.getElementById('inputTransferPin');
  if (!pinInput) return;
  pinInput.value = pinInput.value.slice(0, -1);
  if (window.sounds) window.sounds.playCoin();
}

function fillQuickPin(val = '1234') {
  const pinInput = document.getElementById('inputTransferPin');
  if (!pinInput) return;
  pinInput.value = val;
  if (window.sounds) window.sounds.playCoin();
}

function togglePinVisibility() {
  const pinInput = document.getElementById('inputTransferPin');
  const btn = document.getElementById('btnTogglePin');
  if (!pinInput) return;
  if (pinInput.type === 'password') {
    // Al pasar a type="tel", muestra los números y mantiene el teclado puramente numérico
    pinInput.type = 'tel';
    if (btn) btn.textContent = '🔒';
  } else {
    pinInput.type = 'password';
    if (btn) btn.textContent = '👁️';
  }
}

let transferFacingMode = 'environment';
let transferScanAnimationId = null;
let transferCanvas = null;
let transferCanvasCtx = null;

async function startTransferCamera(isUserAction = false) {
  const video = document.getElementById('transferVideo');
  const status = document.getElementById('transferCameraStatus');
  const helpOverlay = document.getElementById('transferCameraHelp');
  const helpText = document.getElementById('transferCameraHelpText');
  const actionContainer = document.getElementById('transferCameraActionContainer');
  const retryBtn = document.getElementById('btnRetryTransferCamera');
  const flipBtn = document.getElementById('btnFlipTransferCamera');

  if (!video) return;

  stopTransferCamera();

  const isHttp = window.location.protocol !== 'https:' && 
                 window.location.hostname !== 'localhost' && 
                 window.location.hostname !== '127.0.0.1';

  // Si no hay soporte de getUserMedia o estamos en HTTP inseguro
  if (isHttp || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (status) status.textContent = '⚠️ Requiere HTTPS';
    if (helpOverlay) {
      helpOverlay.style.display = 'flex';
      if (helpText) {
        helpText.innerHTML = `
          <div style="font-weight: 800; color: #fca5a5; font-size: 0.85rem; margin-bottom: 4px;">⚠️ Cámara requiere HTTPS</div>
          <span style="font-size: 0.72rem; color: #cbd5e1;">Por seguridad, los navegadores en celulares bloquean la cámara si la conexión no es HTTPS. Toca el botón para abrir la app segura:</span>
        `;
      }
      if (actionContainer) {
        actionContainer.innerHTML = `
          <button type="button" onclick="window.location.href='${CLOUDFLARE_TUNNEL_URL}' + window.location.pathname" style="padding: 10px 16px; background: #10b981; color: white; border: none; border-radius: 10px; font-weight: 900; font-size: 0.84rem; cursor: pointer; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);">
            🚀 Cambiar a HTTPS Seguro
          </button>
        `;
      }
    }
    return;
  }

  // Si estamos en un contexto seguro HTTPS:
  try {
    if (status) status.textContent = 'Conectando cámara...';
    if (helpOverlay) helpOverlay.style.display = 'none';

    // Propiedades obligatorias para iOS Safari WebKit y Chrome Android
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.setAttribute('autoplay', 'true');

    // Intentar abrir cámara con fallbacks progresivos
    const constraintConfigs = [
      { video: { facingMode: { ideal: transferFacingMode }, width: { ideal: 1280 } }, audio: false },
      { video: { facingMode: { ideal: transferFacingMode } }, audio: false },
      { video: { facingMode: transferFacingMode }, audio: false },
      { video: true, audio: false }
    ];

    let stream = null;
    let lastError = null;

    for (const c of constraintConfigs) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(c);
        if (stream) break;
      } catch (errAttempt) {
        lastError = errAttempt;
      }
    }

    if (!stream) {
      throw lastError || new Error('No se pudo acceder al lente de la cámara');
    }

    transferVideoStream = stream;
    video.srcObject = stream;

    // Esperar a que el elemento video esté listo para reproducir (evita AbortError en Safari)
    await new Promise((resolve) => {
      if (video.readyState >= 1) {
        resolve();
      } else {
        video.onloadedmetadata = () => resolve();
        setTimeout(resolve, 800);
      }
    });

    try {
      await video.play();
    } catch (playErr) {
      console.warn('Reproducción diferida:', playErr);
    }

    if (status) status.textContent = '🟢 Escaneando QR...';
    if (helpOverlay) helpOverlay.style.display = 'none';
    if (retryBtn) retryBtn.style.display = 'none';
    if (flipBtn) flipBtn.style.display = 'inline-block';

    isTransferScanning = true;
    startTransferQrDetection(video);

  } catch (err) {
    console.warn('Error accediendo a cámara:', err);
    let userMsg = 'Toca el botón para permitir el uso de la cámara.';
    const errName = err.name || '';

    if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
      userMsg = '🔒 Permiso denegado: El navegador bloqueó la cámara. Toca el candado o configuración junto a la barra de dirección y habilita la Cámara.';
    } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
      userMsg = '📷 No se detectó ninguna cámara física en este dispositivo.';
    } else if (errName === 'NotReadableError' || errName === 'TrackStartError') {
      userMsg = '⚠️ La cámara está ocupada por otra app (WhatsApp, etc). Ciérrala e intenta de nuevo.';
    } else if (errName === 'OverconstrainedError') {
      userMsg = '⚠️ Tu cámara no admite la resolución solicitada.';
    }

    if (status) status.textContent = '⚠️ Cámara bloqueada';
    if (helpOverlay) {
      helpOverlay.style.display = 'flex';
      if (helpText) {
        helpText.innerHTML = `
          <div style="font-weight: 800; color: #fca5a5; font-size: 0.8rem; margin-bottom: 4px;">⚠️ Permiso Requerido</div>
          <span style="font-size: 0.72rem; color: #f1f5f9;">${userMsg}</span>
        `;
      }
      if (actionContainer) {
        actionContainer.innerHTML = `
          <button type="button" onclick="startTransferCamera(true)" style="padding: 8px 16px; background: #0284c7; color: white; border: none; border-radius: 8px; font-weight: 800; font-size: 0.82rem; cursor: pointer; box-shadow: 0 4px 10px rgba(2, 132, 199, 0.4);">
            📷 Tocar para Permitir Cámara
          </button>
        `;
      }
    }
    if (retryBtn) retryBtn.style.display = 'inline-block';
  }
}

function handleTransferQrPhoto(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const status = document.getElementById('transferCameraStatus');
  if (status) status.textContent = 'Analizando foto...';

  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const maxDim = 1200;
      let w = img.width;
      let h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const imgData = ctx.getImageData(0, 0, w, h);

      if (window.jsQR) {
        const code = window.jsQR(imgData.data, w, h, {
          inversionAttempts: 'attemptBoth'
        });
        if (code && code.data) {
          fetchStudentByScannedQr(code.data);
          return;
        }
      }
      if (status) status.textContent = '❌ No se detectó QR';
      alert('⚠️ No se detectó ningún código QR en la foto. Intenta tomarla más de cerca con buena iluminación.');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function flipTransferCamera() {
  transferFacingMode = transferFacingMode === 'environment' ? 'user' : 'environment';
  startTransferCamera(true);
}

function stopTransferCamera() {
  isTransferScanning = false;
  if (transferScanAnimationId) {
    cancelAnimationFrame(transferScanAnimationId);
    transferScanAnimationId = null;
  }
  if (transferVideoStream) {
    transferVideoStream.getTracks().forEach(t => t.stop());
    transferVideoStream = null;
  }
}

function startTransferQrDetection(video) {
  if (!transferCanvas) {
    transferCanvas = document.createElement('canvas');
    transferCanvasCtx = transferCanvas.getContext('2d', { willReadFrequently: true });
  }

  function scanFrame() {
    if (isTransferScanning && selectedTransferTarget === null && video.readyState === video.HAVE_ENOUGH_DATA) {
      transferCanvas.width = video.videoWidth;
      transferCanvas.height = video.videoHeight;
      transferCanvasCtx.drawImage(video, 0, 0, transferCanvas.width, transferCanvas.height);
      const imageData = transferCanvasCtx.getImageData(0, 0, transferCanvas.width, transferCanvas.height);

      if (window.jsQR) {
        const code = window.jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert'
        });
        if (code && code.data) {
          fetchStudentByScannedQr(code.data);
          return;
        }
      }
    }

    if (isTransferScanning && selectedTransferTarget === null) {
      transferScanAnimationId = requestAnimationFrame(scanFrame);
    }
  }

  transferScanAnimationId = requestAnimationFrame(scanFrame);
}

async function fetchStudentByScannedQr(rawValue) {
  try {
    const res = await fetch(`/api/estudiantes/qr/${encodeURIComponent(rawValue)}`);
    if (res.ok) {
      const found = await res.json();
      if (found.id !== currentStudent.id) {
        stopTransferCamera();
        onTransferTargetIdentified(found);
      } else {
        alert('⚠️ Este es tu propio código QR. Escanea el carné o QR de tu compañero.');
      }
    }
  } catch (e) {}
}

async function executeP2PTransfer() {
  if (!currentStudent || !selectedTransferTarget) return;

  let monto = currentTransferAmount;
  const custom = parseInt(document.getElementById('inputTransferCustomAmount').value, 10);
  if (custom && custom > 0) {
    monto = custom;
  }

  const pin = document.getElementById('inputTransferPin').value.trim();
  if (!pin) {
    if (window.sounds) window.sounds.playError();
    return alert('⚠️ Por favor ingresa tu PIN de seguridad (por defecto 1234).');
  }

  const motivo = document.getElementById('inputTransferMotivo').value.trim();

  const btn = document.getElementById('btnConfirmTransfer');
  btn.disabled = true;
  btn.textContent = 'Transfiriendo saldo...';

  try {
    const res = await fetch('/api/transferencias', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emisor_id: currentStudent.id,
        receptor_id: selectedTransferTarget.id,
        monto,
        pin,
        motivo
      })
    });

    const data = await res.json();
    if (!res.ok) {
      if (window.sounds) window.sounds.playError();
      throw new Error(data.error);
    }

    if (window.sounds) window.sounds.playSuccess();

    alert(`🎉 ¡TRANSFERENCIA EXITOSA!\nLe pasaste ₡${data.monto.toLocaleString('es-CR')} a ${data.receptor.nombre}.\nTu nuevo saldo es ₡${data.emisor.saldo_nuevo.toLocaleString('es-CR')}.`);

    closeTransferModal();
    await selectStudent(currentStudent.id);
  } catch (err) {
    alert(`❌ Fallo en la transferencia: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>💸</span> Enviar Dinero al Instante';
  }
}

// Toggle Parental para permitir/bloquear transferencias
async function onToggleAllowTransfer(checked) {
  if (!currentStudent) return;
  try {
    await fetch(`/api/estudiantes/${currentStudent.id}/limite`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permitir_transferencias: checked ? 1 : 0 })
    });
    currentStudent.permitir_transferencias = checked ? 1 : 0;
    if (window.sounds) window.sounds.playCoin();
  } catch (e) {
    console.error('Error actualizando permiso de transferencias:', e);
  }
}

function triggerBalancePulse() {
  const el = document.getElementById('walletBalance');
  if (el) {
    el.classList.remove('balance-updated');
    void el.offsetWidth;
    el.classList.add('balance-updated');
  }
  const dispEl = document.getElementById('dailyAvailableText');
  if (dispEl) {
    dispEl.classList.remove('balance-updated');
    void dispEl.offsetWidth;
    dispEl.classList.add('balance-updated');
  }
}

// SSE en tiempo real para eventos de la soda y monederos
function initStudentSSE() {
  const sse = new EventSource('/api/events');

  // Cobro inmediato en caja / pre-orden realizada
  sse.addEventListener('nueva_orden', (e) => {
    try {
      const data = JSON.parse(e.data);
      const estId = data.estudiante_id || (data.financiero && data.financiero.estudiante && data.financiero.estudiante.id);

      // Si el estudiante en pantalla fue a quien se le cobró
      if (currentStudent && currentStudent.id === estId) {
        if (window.sounds) window.sounds.playCoin();

        if (data.financiero && data.financiero.estudiante) {
          const f = data.financiero.estudiante;
          currentStudent.saldo_colones = f.saldo_nuevo;
          currentStudent.gastado_hoy = f.gastado_hoy;
          currentStudent.disponible_hoy = (typeof f.disponible_hoy === 'number')
            ? f.disponible_hoy
            : Math.max(0, (f.limite_diario || currentStudent.limite_diario_colones || 0) - (f.gastado_hoy || 0));
          updateStudentUI();
          triggerBalancePulse();
        }
        selectStudent(currentStudent.id);
      }

      // Si es padre de este estudiante
      if (currentUser && currentUser.rol === 'padre') {
        loadParentDashboard();
      }

      // Si es admin
      if (currentUser && currentUser.rol === 'admin') {
        loadAdminData();
      }
    } catch (err) {
      console.warn('Error en SSE nueva_orden:', err);
    }
  });

  // Saldo actualizado (débito, recarga, ajuste de límite)
  sse.addEventListener('saldo_actualizado', (e) => {
    try {
      const data = JSON.parse(e.data);
      const estId = data.estudiante_id || data.id;

      if (currentStudent && currentStudent.id === estId) {
        if (window.sounds) window.sounds.playCoin();
        if (typeof data.saldo_colones === 'number') currentStudent.saldo_colones = data.saldo_colones;
        if (typeof data.disponible_hoy === 'number') currentStudent.disponible_hoy = data.disponible_hoy;
        if (typeof data.gastado_hoy === 'number') currentStudent.gastado_hoy = data.gastado_hoy;
        updateStudentUI();
        triggerBalancePulse();
        selectStudent(currentStudent.id);
      }

      if (currentUser && currentUser.rol === 'padre') {
        loadParentDashboard();
      }
      if (currentUser && currentUser.rol === 'admin') {
        loadAdminData();
      }
    } catch (err) {}
  });

  sse.addEventListener('transferencia_realizada', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (currentStudent && data.receptor && data.receptor.id === currentStudent.id) {
        if (window.sounds) window.sounds.playCoin();
        alert(`🔔 ¡Te pasaron plata!\n${data.emisor.nombre} te transfirió ₡${data.monto.toLocaleString('es-CR')}.\nMotivo: ${data.motivo}`);
        selectStudent(currentStudent.id);
        triggerBalancePulse();
      } else if (currentStudent && data.emisor && data.emisor.id === currentStudent.id) {
        if (typeof data.emisor.saldo_nuevo === 'number') {
          currentStudent.saldo_colones = data.emisor.saldo_nuevo;
          updateStudentUI();
          triggerBalancePulse();
        }
        selectStudent(currentStudent.id);
      }

      if (currentUser && currentUser.rol === 'padre') {
        loadParentDashboard();
      }
    } catch (err) {}
  });

  sse.addEventListener('recarga_exitosa', (e) => {
    try {
      const data = JSON.parse(e.data);
      const estId = data.estudiante_id || data.id;
      if (currentStudent && currentStudent.id === estId) {
        if (window.sounds) window.sounds.playCoin();
        if (typeof data.saldo_nuevo === 'number') {
          currentStudent.saldo_colones = data.saldo_nuevo;
          updateStudentUI();
          triggerBalancePulse();
        }
        selectStudent(currentStudent.id);
      }
      if (currentUser && currentUser.rol === 'padre') {
        loadParentDashboard();
      }
      if (currentUser && (currentUser.rol === 'admin' || currentUser.rol === 'cajero')) {
        loadAdminData();
        const movTab = document.getElementById('adminTabContentMovimientos');
        if (movTab && movTab.style.display !== 'none') {
          loadAdminMovimientos();
        }
      }
    } catch (err) {}
  });

  sse.addEventListener('producto_actualizado', (e) => {
    try {
      const prod = JSON.parse(e.data);
      // Actualizar en el catálogo de estudiantes
      const idx = products.findIndex(p => p.id === prod.id);
      if (idx !== -1) {
        products[idx] = { ...products[idx], ...prod };
        renderProducts();
      }
      // Actualizar en admin
      if (currentUser && (currentUser.rol === 'admin' || currentUser.rol === 'cajero')) {
        const adminIdx = adminProducts.findIndex(p => p.id === prod.id);
        if (adminIdx !== -1) {
          adminProducts[adminIdx] = { ...adminProducts[adminIdx], ...prod };
          filterAdminProducts(adminSearchQuery);
        }
      }
    } catch (err) {}
  });

  sse.addEventListener('estudiante_actualizado', (e) => {
    try {
      const data = JSON.parse(e.data);
      const estId = data.id || data.estudiante_id;
      if (currentStudent && currentStudent.id === estId) {
        if (typeof data.saldo_colones === 'number') currentStudent.saldo_colones = data.saldo_colones;
        if (typeof data.disponible_hoy === 'number') currentStudent.disponible_hoy = data.disponible_hoy;
        if (typeof data.gastado_hoy === 'number') currentStudent.gastado_hoy = data.gastado_hoy;
        if (typeof data.limite_diario_colones === 'number') currentStudent.limite_diario_colones = data.limite_diario_colones;
        updateStudentUI();
        triggerBalancePulse();
        selectStudent(currentStudent.id);
      }
      if (currentUser && currentUser.rol === 'padre') {
        loadParentDashboard();
      }
      if (currentUser && (currentUser.rol === 'admin' || currentUser.rol === 'cajero')) {
        loadAdminData();
        const movTab = document.getElementById('adminTabContentMovimientos');
        if (movTab && movTab.style.display !== 'none') {
          loadAdminMovimientos();
        }
      }
    } catch (err) {}
  });

  sse.addEventListener('movimiento_revertido', (e) => {
    try {
      if (currentUser && (currentUser.rol === 'admin' || currentUser.rol === 'cajero')) {
        loadAdminData();
        const movTab = document.getElementById('adminTabContentMovimientos');
        if (movTab && movTab.style.display !== 'none') {
          loadAdminMovimientos();
        }
      }
    } catch (err) {}
  });
}

// ==========================================
// FUNCIONES DEL PORTAL DEDICADO DE PADRES
// ==========================================

async function loadParentDashboard() {
  if (!currentUser || currentUser.rol !== 'padre') return;

  const parentLoggedName = document.getElementById('parentLoggedName');
  if (parentLoggedName) {
    parentLoggedName.textContent = currentUser.nombre ? `${currentUser.nombre} (Padre/Madre)` : 'Familia RecreoPay';
  }

  try {
    const res = await fetch(`/api/padres/mis-hijos?padre_usuario_id=${currentUser.id}`);
    const data = await res.json();
    if (res.ok && data.hijos) {
      currentUser.hijos = data.hijos;
      localStorage.setItem('recreopay_user', JSON.stringify(currentUser));
    }
  } catch (err) {
    console.warn('Error al cargar hijos del padre:', err);
  }

  renderParentDashboardView();
}

function renderParentDashboardView() {
  const bannerNoHijos = document.getElementById('parentNoChildrenBanner');
  const sectionHijos = document.getElementById('parentChildrenSection');
  const containerActive = document.getElementById('parentSelectedChildContainer');
  const grid = document.getElementById('parentChildrenGrid');

  const hijos = (currentUser && currentUser.hijos) ? currentUser.hijos : [];

  if (hijos.length === 0) {
    if (bannerNoHijos) bannerNoHijos.style.display = 'block';
    if (containerActive) containerActive.style.display = 'none';
    if (grid) grid.innerHTML = '';
    return;
  }

  if (bannerNoHijos) bannerNoHijos.style.display = 'none';
  if (containerActive) containerActive.style.display = 'block';

  // Si no hay hijo seleccionado o el seleccionado ya no existe en la lista, seleccionar el primero
  if (!currentParentChild || !hijos.some(h => h.id === currentParentChild.id)) {
    currentParentChild = hijos[0];
  } else {
    // Actualizar datos del hijo seleccionado desde la lista actualizada
    currentParentChild = hijos.find(h => h.id === currentParentChild.id) || hijos[0];
  }

  // Renderizar tarjetas de hijos en la cuadrícula
  if (grid) {
    grid.innerHTML = hijos.map(h => {
      const isSelected = currentParentChild && currentParentChild.id === h.id;
      const isBlocked = !!h.tarjeta_bloqueada;
      return `
        <div class="parent-child-card ${isSelected ? 'active' : ''}" onclick="selectParentChild(${h.id})">
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
            <img src="${h.foto_url || '/img/avatar_default.png'}" style="width: 42px; height: 42px; border-radius: 50%; border: 2px solid ${isSelected ? '#0284c7' : 'var(--border)'}; object-fit: cover;">
            <div style="min-width: 0; flex: 1;">
              <strong style="font-size: 0.9rem; color: var(--text-main); display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${h.nombre_completo}
              </strong>
              <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600;">
                ${h.grado} - Sec. ${h.seccion}
              </span>
            </div>
            ${isBlocked ? '<span style="font-size: 0.65rem; background: #fee2e2; color: #dc2626; padding: 2px 6px; border-radius: 4px; font-weight: 800;">BLOQUEADO</span>' : ''}
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border); padding-top: 6px; margin-top: 4px;">
            <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 700;">Saldo:</span>
            <strong style="font-size: 1.05rem; color: #0284c7; font-weight: 900;">
              ₡${(h.saldo_colones || 0).toLocaleString('es-CR')}
            </strong>
          </div>
        </div>
      `;
    }).join('');
  }

  renderActiveChildDetails(currentParentChild);
}

function selectParentChild(childId) {
  const hijos = (currentUser && currentUser.hijos) ? currentUser.hijos : [];
  const found = hijos.find(h => h.id === childId);
  if (found) {
    currentParentChild = found;
    renderParentDashboardView();
    if (window.sounds) window.sounds.playTap();
  }
}

function renderActiveChildDetails(child) {
  if (!child) return;

  const avatar = document.getElementById('parentActiveChildAvatar');
  const name = document.getElementById('parentActiveChildName');
  const meta = document.getElementById('parentActiveChildMeta');
  const balance = document.getElementById('parentActiveChildBalance');
  const lblLimit = document.getElementById('lblParentDailyLimitDisplay');
  const inputCustomLimit = document.getElementById('inputParentCustomLimit');
  const rangeLimit = document.getElementById('rangeParentLimit');
  const chkTransfer = document.getElementById('chkParentAllowTransferDirect');

  if (avatar) avatar.src = child.foto_url || '/img/avatar_default.png';
  if (name) name.textContent = child.nombre_completo;
  if (meta) meta.textContent = `${child.grado} - Sección ${child.seccion} • Cód: ${child.codigo_estudiante}`;
  if (balance) balance.textContent = `₡${(child.saldo_colones || 0).toLocaleString('es-CR')}`;

  const currentLimit = child.limite_diario_colones || 3000;
  if (lblLimit) lblLimit.textContent = `₡${currentLimit.toLocaleString('es-CR')}`;
  if (inputCustomLimit) inputCustomLimit.value = currentLimit;
  if (rangeLimit) rangeLimit.value = currentLimit;
  if (chkTransfer) chkTransfer.checked = child.permitir_transferencias !== 0;

  loadActiveChildHistory(child.id);
}

async function loadActiveChildHistory(studentId) {
  const container = document.getElementById('parentStudentHistoryList');
  if (!container) return;

  container.innerHTML = '<span style="color: var(--text-muted);">Cargando historial de compras...</span>';

  try {
    const res = await fetch(`/api/ordenes?estudiante_id=${studentId}`);
    const ordenes = await res.json();

    if (!Array.isArray(ordenes) || ordenes.length === 0) {
      container.innerHTML = '<span style="color: var(--text-muted); font-size: 0.8rem;">Sin compras recientes registradas en la soda.</span>';
      return;
    }

    container.innerHTML = ordenes.slice(0, 10).map(o => {
      const itemsStr = (o.items && o.items.length > 0)
        ? o.items.map(it => `${it.cantidad}x ${it.nombre}`).join(', ')
        : 'Compra en mostrador';
      const fecha = o.creado_en ? new Date(o.creado_en).toLocaleDateString('es-CR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      return `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px dashed var(--border);">
          <div style="min-width: 0; flex: 1; padding-right: 8px;">
            <div style="font-weight: 800; color: var(--text-main); font-size: 0.82rem; word-break: break-word;">${itemsStr}</div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 1px;">${fecha} • Estado: <span style="color: #10b981; font-weight: 700;">${o.estado}</span></div>
          </div>
          <strong style="color: #0284c7; font-size: 0.88rem; flex-shrink: 0;">-₡${(o.total_colones || 0).toLocaleString('es-CR')}</strong>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = '<span style="color: #ef4444; font-size: 0.78rem;">No se pudo cargar el historial.</span>';
  }
}

function setParentSinpePreset(amt) {
  const input = document.getElementById('inputParentSinpeMonto');
  if (input) input.value = amt;
  if (window.sounds) window.sounds.playTap();
}

async function executeParentSinpeRecharge() {
  if (!currentParentChild) {
    alert('Selecciona primero al estudiante a quien deseas recargarle.');
    return;
  }
  const input = document.getElementById('inputParentSinpeMonto');
  const monto = parseInt(input ? input.value : 0, 10);

  if (isNaN(monto) || monto <= 0) {
    alert('Ingresa un monto válido mayor a ₡0 para recargar.');
    return;
  }

  try {
    const res = await fetch(`/api/estudiantes/${currentParentChild.id}/recarga`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        monto,
        comprobante: 'SINPE-PADRE',
        descripcion: `Recarga SINPE Móvil por Padre/Madre para ${currentParentChild.nombre_completo}`
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (window.sounds) window.sounds.playCoin();
    alert(`🎉 ¡Recarga Exitosa!\nSe agregaron ₡${monto.toLocaleString('es-CR')} al monedero de ${currentParentChild.nombre_completo}.\nNuevo Saldo: ₡${data.saldo_nuevo.toLocaleString('es-CR')}`);

    if (input) input.value = '';
    await loadParentDashboard();
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    alert(`❌ Error al procesar recarga SINPE: ${err.message}`);
  }
}

function setParentLimitPreset(amt) {
  const input = document.getElementById('inputParentCustomLimit');
  const range = document.getElementById('rangeParentLimit');
  const lbl = document.getElementById('lblParentDailyLimitDisplay');
  if (input) input.value = amt;
  if (range) range.value = amt;
  if (lbl) lbl.textContent = `₡${parseInt(amt, 10).toLocaleString('es-CR')}`;
  if (window.sounds) window.sounds.playTap();
}

function onParentLimitSliderChange(val) {
  const input = document.getElementById('inputParentCustomLimit');
  const lbl = document.getElementById('lblParentDailyLimitDisplay');
  if (input) input.value = val;
  if (lbl) lbl.textContent = `₡${parseInt(val, 10).toLocaleString('es-CR')}`;
}

async function saveParentCustomLimit() {
  if (!currentParentChild) return;
  const input = document.getElementById('inputParentCustomLimit');
  const val = parseInt(input ? input.value : 0, 10);

  if (isNaN(val) || val < 500) {
    alert('El límite diario debe ser de al menos ₡500.');
    return;
  }

  try {
    const res = await fetch(`/api/estudiantes/${currentParentChild.id}/limite`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limite_diario_colones: val })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    currentParentChild.limite_diario_colones = val;
    if (window.sounds) window.sounds.playSuccess();
    alert(`🛡️ Límite diario actualizado a ₡${val.toLocaleString('es-CR')} para ${currentParentChild.nombre_completo}.`);
    await loadParentDashboard();
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    alert(`❌ Error al guardar límite: ${err.message}`);
  }
}

async function onToggleParentTransfer(checked) {
  if (!currentParentChild) return;

  try {
    const res = await fetch(`/api/estudiantes/${currentParentChild.id}/limite`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permitir_transferencias: checked ? 1 : 0 })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    currentParentChild.permitir_transferencias = checked ? 1 : 0;
    if (window.sounds) window.sounds.playTap();
  } catch (err) {
    alert(`❌ No se pudo actualizar permiso de transferencia: ${err.message}`);
  }
}

async function saveParentStudentCredentials() {
  if (!currentParentChild) return;
  const pinInput = document.getElementById('inputParentStudentPin');
  const passInput = document.getElementById('inputParentStudentPass');
  const pin = pinInput ? pinInput.value.trim() : '';
  const pass = passInput ? passInput.value.trim() : '';

  if (!pin && !pass) {
    alert('Ingresa al menos un nuevo PIN o una nueva contraseña.');
    return;
  }

  if (pin && !/^\d{4}$/.test(pin)) {
    alert('El PIN debe contener exactamente 4 dígitos numéricos.');
    return;
  }

  try {
    const res = await fetch('/api/padres/restablecer-acceso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        estudiante_id: currentParentChild.id,
        nuevo_pin: pin || undefined,
        nuevo_password: pass || undefined
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (window.sounds) window.sounds.playSuccess();
    alert(`✅ ¡Credenciales de acceso escolar actualizadas!\n${data.mensaje}`);
    if (pinInput) pinInput.value = '';
    if (passInput) passInput.value = '';
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    alert(`❌ Error al actualizar credenciales: ${err.message}`);
  }
}

function switchToSodaMenuAsParent() {
  if (!currentParentChild && currentUser.hijos && currentUser.hijos.length > 0) {
    currentParentChild = currentUser.hijos[0];
  }
  if (currentParentChild) {
    selectStudent(currentParentChild.id);
  }
  const viewPadres = document.getElementById('viewPadres');
  const appContainer = document.getElementById('appContainer');
  const bottomNav = document.getElementById('pwaBottomNav');
  const btnPadres = document.getElementById('btnModePadres');
  if (viewPadres) viewPadres.style.display = 'none';
  if (appContainer) appContainer.style.display = 'block';
  if (bottomNav) bottomNav.style.display = 'flex';
  if (btnPadres) {
    btnPadres.style.display = 'inline-block';
    btnPadres.innerHTML = '⬅ Portal Padres';
    btnPadres.onclick = () => returnToParentDashboard();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function returnToParentDashboard() {
  const viewPadres = document.getElementById('viewPadres');
  const appContainer = document.getElementById('appContainer');
  const bottomNav = document.getElementById('pwaBottomNav');
  if (viewPadres) viewPadres.style.display = 'block';
  if (appContainer) appContainer.style.display = 'none';
  if (bottomNav) bottomNav.style.display = 'none';
  loadParentDashboard();
}

// ==========================================
// ESCANEO QR Y VINCULACIÓN DE ESTUDIANTES PARA PADRES
// ==========================================

let currentLinkChildTab = 'camera';
let currentLinkCandidateStudent = null;

function openScanChildQrModal() {
  const modal = document.getElementById('modalScanChildQr');
  if (modal) modal.style.display = 'flex';
  
  const input = document.getElementById('inputManualStudentCode');
  if (input) input.value = '';
  
  resetLinkChildToTabs();
  switchLinkChildTab('camera');
}

function closeScanChildQrModal(event) {
  if (event && event.target && event.target.id !== 'modalScanChildQr') {
    return;
  }
  stopScanChildCamera();
  const modal = document.getElementById('modalScanChildQr');
  if (modal) modal.style.display = 'none';
  currentLinkCandidateStudent = null;
}

function switchLinkChildTab(tab) {
  currentLinkChildTab = tab;
  const btnCamera = document.getElementById('tabBtnLinkCamera');
  const btnCode = document.getElementById('tabBtnLinkCode');
  const panelCamera = document.getElementById('panelLinkCamera');
  const panelCode = document.getElementById('panelLinkCode');
  const errorMsg = document.getElementById('linkStudentErrorMsg');
  if (errorMsg) errorMsg.style.display = 'none';

  if (tab === 'camera') {
    if (btnCamera) {
      btnCamera.style.background = '#ffffff';
      btnCamera.style.color = '#0284c7';
      btnCamera.style.boxShadow = '0 2px 4px rgba(0,0,0,0.06)';
      btnCamera.style.fontWeight = '800';
    }
    if (btnCode) {
      btnCode.style.background = 'transparent';
      btnCode.style.color = '#64748b';
      btnCode.style.boxShadow = 'none';
      btnCode.style.fontWeight = '700';
    }
    if (panelCamera) panelCamera.style.display = 'block';
    if (panelCode) panelCode.style.display = 'none';
    startScanChildCamera();
  } else {
    stopScanChildCamera();
    if (btnCode) {
      btnCode.style.background = '#ffffff';
      btnCode.style.color = '#0284c7';
      btnCode.style.boxShadow = '0 2px 4px rgba(0,0,0,0.06)';
      btnCode.style.fontWeight = '800';
    }
    if (btnCamera) {
      btnCamera.style.background = 'transparent';
      btnCamera.style.color = '#64748b';
      btnCamera.style.boxShadow = 'none';
      btnCamera.style.fontWeight = '700';
    }
    if (panelCamera) panelCamera.style.display = 'none';
    if (panelCode) panelCode.style.display = 'block';
    const input = document.getElementById('inputManualStudentCode');
    if (input) {
      input.focus();
    }
  }

  if (window.sounds) window.sounds.playTap();
}

// DETECTOR UNIVERSAL DE CÓDIGOS QR (BARCODE DETECTOR CON HARDWARE ACCELERATION + FALLBACK JSQR OPTIMIZADO)
let nativeBarcodeDetector = null;
if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
  try {
    nativeBarcodeDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
  } catch (e) {
    console.warn('BarcodeDetector formats no soportados:', e);
  }
}

async function detectQrFromMedia(video, canvas, ctx) {
  if (!video || video.videoWidth === 0 || video.videoHeight === 0 || video.readyState < 2) {
    return null;
  }

  // 1. Detección nativa por aceleración de hardware (ultrarrápida ~1ms)
  if (nativeBarcodeDetector) {
    try {
      const barcodes = await nativeBarcodeDetector.detect(video);
      if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
        return barcodes[0].rawValue.trim();
      }
    } catch (e) {
      // Ignorar error transitorio y continuar a jsQR
    }
  }

  // 2. Fallback de jsQR optimizado por downscale (máx 640px para 30-60 FPS fluidos)
  if (window.jsQR && canvas && ctx) {
    let w = video.videoWidth;
    let h = video.videoHeight;
    const maxDim = 640;
    if (w > maxDim || h > maxDim) {
      if (w > h) {
        h = Math.round((h * maxDim) / w);
        w = maxDim;
      } else {
        w = Math.round((w * maxDim) / h);
        h = maxDim;
      }
    }

    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;

    ctx.drawImage(video, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);

    // Intento 1: Sin invertir (el 99% de los carnés son oscuros sobre fondo claro)
    let qr = window.jsQR(imageData.data, w, h, { inversionAttempts: 'dontInvert' });
    if (!qr || !qr.data) {
      // Intento 2: Inversión en caso de pantalla oscura o reflejos
      qr = window.jsQR(imageData.data, w, h, { inversionAttempts: 'attemptBoth' });
    }

    if (qr && qr.data && String(qr.data).trim().length > 0) {
      return String(qr.data).trim();
    }
  }

  return null;
}

let isScanChildLoopRunning = false;
let isProcessingChildScan = false;

async function startScanChildCamera() {
  stopScanChildCamera();
  const video = document.getElementById('videoScanChild');
  const canvas = document.getElementById('canvasScanChild');
  const badge = document.getElementById('badgeCameraChildStatus');
  if (!video || !canvas) return;

  try {
    scanChildStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
    });
    video.srcObject = scanChildStream;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.muted = true;
    await video.play();

    if (badge) {
      badge.textContent = '📷 Apunta al código QR del carné';
      badge.style.color = '#38bdf8';
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    isScanChildLoopRunning = true;
    isProcessingChildScan = false;

    async function scanFrame() {
      if (!isScanChildLoopRunning || !scanChildStream) return;

      if (!isProcessingChildScan) {
        const detected = await detectQrFromMedia(video, canvas, ctx);
        if (detected && !isProcessingChildScan) {
          isProcessingChildScan = true;
          handleChildQrDetected(detected);
          return;
        }
      }

      if (isScanChildLoopRunning) {
        scanChildAnimId = requestAnimationFrame(scanFrame);
      }
    }

    scanChildAnimId = requestAnimationFrame(scanFrame);
  } catch (err) {
    console.warn('Cámara no disponible para escaneo de carné:', err);
    if (badge) {
      badge.textContent = '⚠️ Cámara no disponible - Digita el código';
      badge.style.color = '#fca5a5';
    }
  }
}

function stopScanChildCamera() {
  isScanChildLoopRunning = false;
  isProcessingChildScan = false;
  if (scanChildAnimId) {
    cancelAnimationFrame(scanChildAnimId);
    scanChildAnimId = null;
  }
  if (scanChildStream) {
    try {
      scanChildStream.getTracks().forEach(t => t.stop());
    } catch (e) {}
    scanChildStream = null;
  }
  const video = document.getElementById('videoScanChild');
  if (video) {
    video.srcObject = null;
  }
}

async function handleChildQrDetected(token) {
  stopScanChildCamera();
  if (window.sounds) window.sounds.playScanChirp();
  await showStudentConfirmationForLink(token);
}

async function validateStudentCodeForLink() {
  const input = document.getElementById('inputManualStudentCode');
  const val = input ? input.value.trim() : '';
  const errorMsg = document.getElementById('linkStudentErrorMsg');
  const btn = document.getElementById('btnValidateStudentCode');

  if (!val) {
    if (errorMsg) {
      errorMsg.textContent = '⚠️ Por favor ingresa el código del estudiante (ej: EST-2026-001).';
      errorMsg.style.display = 'block';
    }
    return;
  }

  if (errorMsg) errorMsg.style.display = 'none';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Buscando...';
  }

  try {
    await showStudentConfirmationForLink(val);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>🔍</span> Validar';
    }
  }
}

async function showStudentConfirmationForLink(tokenOrCode) {
  const errorMsg = document.getElementById('linkStudentErrorMsg');
  if (errorMsg) errorMsg.style.display = 'none';

  try {
    const res = await fetch(`/api/estudiantes/qr/${encodeURIComponent(tokenOrCode.trim())}`);
    const student = await res.json();
    if (!res.ok) throw new Error(student.error || 'Código escolar no encontrado');

    currentLinkCandidateStudent = student;

    // Poblar tarjeta de confirmación
    const avatar = document.getElementById('linkPreviewAvatar');
    const name = document.getElementById('linkPreviewName');
    const grade = document.getElementById('linkPreviewGrade');
    const code = document.getElementById('linkPreviewCode');

    if (avatar) avatar.src = student.foto_url || '/img/avatar_default.png';
    if (name) name.textContent = student.nombre_completo;
    if (grade) grade.textContent = `${student.grado} - Sección ${student.seccion}`;
    if (code) code.textContent = `Carné: ${student.codigo_estudiante}`;

    // Cambiar a vista de confirmación
    const viewTabs = document.getElementById('linkChildViewTabs');
    const viewConfirm = document.getElementById('linkChildViewConfirm');
    if (viewTabs) viewTabs.style.display = 'none';
    if (viewConfirm) viewConfirm.style.display = 'block';

    if (window.sounds) window.sounds.playSuccess();
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    if (errorMsg) {
      errorMsg.textContent = `⚠️ No se encontró ningún estudiante con el código "${tokenOrCode}". Verifica que el código esté bien escrito e intenta de nuevo.`;
      errorMsg.style.display = 'block';
    }
    // Si estábamos en cámara, reiniciar escaneo tras 2 segundos si el usuario sigue en la pestaña cámara
    if (currentLinkChildTab === 'camera') {
      setTimeout(() => {
        const modal = document.getElementById('modalScanChildQr');
        if (modal && modal.style.display !== 'none' && currentLinkChildTab === 'camera' && !currentLinkCandidateStudent) {
          startScanChildCamera();
        }
      }, 2000);
    }
  }
}

function resetLinkChildToTabs() {
  currentLinkCandidateStudent = null;
  const viewTabs = document.getElementById('linkChildViewTabs');
  const viewConfirm = document.getElementById('linkChildViewConfirm');
  const errorMsg = document.getElementById('linkStudentErrorMsg');

  if (viewTabs) viewTabs.style.display = 'block';
  if (viewConfirm) viewConfirm.style.display = 'none';
  if (errorMsg) errorMsg.style.display = 'none';

  if (currentLinkChildTab === 'camera') {
    startScanChildCamera();
  } else {
    const input = document.getElementById('inputManualStudentCode');
    if (input) input.focus();
  }
}

async function confirmLinkValidatedChild() {
  if (!currentUser || !currentUser.id) {
    alert('Debes iniciar sesión como padre para vincular un estudiante.');
    return;
  }
  if (!currentLinkCandidateStudent) {
    alert('No hay ningún estudiante seleccionado para vincular.');
    return;
  }

  const btnConfirm = document.getElementById('btnConfirmLinkChild');
  if (btnConfirm) {
    btnConfirm.disabled = true;
    btnConfirm.innerHTML = '<span>⏳</span> Vinculando...';
  }

  try {
    const res = await fetch('/api/padres/vincular-hijo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        padre_usuario_id: currentUser.id,
        qr_token_o_codigo: currentLinkCandidateStudent.codigo_estudiante || currentLinkCandidateStudent.qr_token
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    currentUser.hijos = data.hijos;
    localStorage.setItem('recreopay_user', JSON.stringify(currentUser));
    currentParentChild = data.estudiante;

    closeScanChildQrModal();
    if (window.sounds) window.sounds.playSuccess();
    alert(`🎉 ¡Éxito!\n${data.mensaje}`);
    renderParentDashboardView();
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    alert(`❌ ${err.message}`);
  } finally {
    if (btnConfirm) {
      btnConfirm.disabled = false;
      btnConfirm.innerHTML = '<span>✅</span> Confirmar y Vincular';
    }
  }
}

// ==========================================
// PANEL DE ADMINISTRACIÓN DE LA SODA
// ==========================================

function switchAdminTab(tabName) {
  const tabs = ['inventario', 'estudiantes', 'recarga', 'movimientos'];
  tabs.forEach(t => {
    const btn = document.getElementById(`btnTabAdmin${t.charAt(0).toUpperCase() + t.slice(1)}`);
    const content = document.getElementById(`adminTabContent${t.charAt(0).toUpperCase() + t.slice(1)}`);
    if (btn) btn.classList.toggle('active', t === tabName);
    if (content) content.style.display = (t === tabName) ? 'block' : 'none';
  });

  if (tabName === 'movimientos') {
    loadAdminMovimientos();
  } else if (tabName === 'recarga') {
    if (!adminSelectedStudent) {
      clearAdminSelectedStudent();
    }
  }

  if (window.sounds) window.sounds.playTap();
}

async function loadAdminData() {
  try {
    // 1. Cargar resumen y métricas
    const resResumen = await fetch('/api/admin/resumen');
    adminStats = await resResumen.json();

    document.getElementById('adminStatVentas').textContent = `₡${adminStats.ventas_hoy.toLocaleString('es-CR')}`;
    document.getElementById('adminStatOrdenes').textContent = adminStats.ordenes_hoy;
    document.getElementById('adminStatEstudiantes').textContent = adminStats.estudiantes_activos;
    document.getElementById('adminStatBloqueados').textContent = adminStats.tarjetas_bloqueadas;
    document.getElementById('adminStatCriticos').textContent = adminStats.productos_bajo_stock;

    // 2. Cargar productos de inventario
    const resProd = await fetch('/api/admin/productos');
    adminProducts = await resProd.json();
    renderAdminInventory(adminProducts);

    // 3. Cargar estudiantes
    const resEst = await fetch('/api/estudiantes');
    students = await resEst.json();
    renderAdminStudents(students);
    populateAdminRecargaStudents(students);
  } catch (err) {
    console.error('Error cargando datos de administración:', err);
  }
}

function filterAdminProducts(query) {
  adminSearchQuery = (query || '').toLowerCase().trim();
  let list = adminProducts;
  if (adminSearchQuery) {
    list = list.filter(p => p.nombre.toLowerCase().includes(adminSearchQuery) || (p.categoria_nombre && p.categoria_nombre.toLowerCase().includes(adminSearchQuery)));
  }
  renderAdminInventory(list);
}

function renderAdminInventory(list) {
  const container = document.getElementById('adminProductsList');
  if (!container) return;

  if (!list || list.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 24px; color: var(--text-muted);">
        No se encontraron productos en el inventario.
      </div>
    `;
    return;
  }

  container.innerHTML = list.map(p => {
    const isOutOfStock = p.control_stock === 1 && (p.stock <= 0 || p.disponible === 0);
    const isLowStock = p.control_stock === 1 && p.stock > 0 && p.stock <= 3;
    
    let statusPill = '';
    if (p.control_stock === 0) {
      statusPill = `<span style="font-size: 0.7rem; font-weight: 800; color: #0284c7; background: #e0f2fe; padding: 3px 8px; border-radius: 6px;">Ilimitado</span>`;
    } else if (isOutOfStock) {
      statusPill = `<span style="font-size: 0.7rem; font-weight: 900; color: #ef4444; background: #fee2e2; padding: 3px 8px; border-radius: 6px;">🚫 AGOTADO</span>`;
    } else if (isLowStock) {
      statusPill = `<span style="font-size: 0.7rem; font-weight: 800; color: #d97706; background: #fef3c7; padding: 3px 8px; border-radius: 6px;">⚠️ Quedan ${p.stock}</span>`;
    } else {
      statusPill = `<span style="font-size: 0.7rem; font-weight: 800; color: #166534; background: #dcfce7; padding: 3px 8px; border-radius: 6px;">🟢 ${p.stock} unid.</span>`;
    }

    return `
      <div class="inventory-item-row" style="${isOutOfStock ? 'background: #fff1f2;' : ''}">
        <div class="inventory-item-top">
          <div style="font-size: 1.8rem; text-align: center; flex-shrink: 0; min-width: 40px;">${p.icono || '🥪'}</div>
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              <strong style="font-size: 0.92rem; color: var(--text-main); word-break: break-word;">${p.nombre}</strong>
              ${statusPill}
            </div>
            <div style="font-size: 0.74rem; color: var(--text-muted); margin-top: 2px;">
              ${p.categoria_nombre || 'General'} • ₡${p.precio_colones.toLocaleString('es-CR')}
            </div>
          </div>
        </div>

        <!-- Controles rápidos de stock -->
        <div class="inventory-item-bottom">
          <div class="inventory-stock-controls">
            <button type="button" class="stock-btn-quick" onclick="quickAdjustStock(${p.id}, -1)" title="Restar 1">-1</button>
            <input type="number" id="inputStock_${p.id}" value="${p.stock || 0}" min="0" style="width: 50px; text-align: center; padding: 5px; border-radius: 8px; border: 1.5px solid var(--border); font-weight: 900; font-size: 0.95rem; background: var(--card-bg); color: var(--text-main);">
            <button type="button" class="stock-btn-quick" onclick="quickAdjustStock(${p.id}, 5)" title="Sumar 5">+5</button>
            <button type="button" class="stock-btn-quick" onclick="quickAdjustStock(${p.id}, 10)" title="Sumar 10">+10</button>
          </div>

          <div>
            <button type="button" onclick="saveProductStock(${p.id})" style="padding: 7px 14px; background: #0284c7; color: white; border: none; border-radius: 8px; font-size: 0.8rem; font-weight: 800; cursor: pointer; white-space: nowrap;">
              💾 Guardar
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function quickAdjustStock(prodId, delta) {
  try {
    const res = await fetch(`/api/admin/productos/${prodId}/ajuste-rapido`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta })
    });
    if (!res.ok) throw new Error('Error ajustando stock');
    if (window.sounds) window.sounds.playCoin();
    await loadAdminData();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function saveProductStock(prodId) {
  const input = document.getElementById(`inputStock_${prodId}`);
  if (!input) return;
  const nuevoStock = parseInt(input.value, 10);
  if (isNaN(nuevoStock) || nuevoStock < 0) {
    alert('Ingresa una cantidad de stock válida.');
    return;
  }

  try {
    const res = await fetch(`/api/admin/productos/${prodId}/stock`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stock: nuevoStock, control_stock: 1 })
    });
    if (!res.ok) throw new Error('Error guardando stock');
    if (window.sounds) window.sounds.playSuccess();
    await loadAdminData();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

function renderAdminStudents(list) {
  const container = document.getElementById('adminStudentsList');
  if (!container) return;

  if (!list || list.length === 0) {
    container.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted);">No hay estudiantes registrados.</div>`;
    return;
  }

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 10px;">
      ${list.map(s => {
        const isBlocked = s.tarjeta_bloqueada === 1;
        return `
          <div class="admin-student-card" style="display: flex; flex-direction: column; gap: 10px; padding: 12px; border-radius: 12px; border: 1.5px solid ${isBlocked ? '#fca5a5' : 'var(--border)'}; background: ${isBlocked ? '#fff5f5' : 'var(--card-bg)'}; width: 100%; box-sizing: border-box;">
            <div style="display: flex; align-items: center; gap: 10px; width: 100%;">
              <img src="${s.foto_url || 'https://api.dicebear.com/7.x/bottts/svg?seed=est'}" style="width: 44px; height: 44px; border-radius: 50%; border: 2px solid ${isBlocked ? '#ef4444' : '#0284c7'}; background: white; flex-shrink: 0;">
              <div style="flex: 1; min-width: 0; word-break: break-word;">
                <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                  <strong style="font-size: 0.95rem; color: var(--text-main);">${s.nombre_completo}</strong>
                  ${isBlocked ? '<span style="font-size: 0.68rem; font-weight: 900; background: #ef4444; color: white; padding: 2px 7px; border-radius: 5px;">⛔ SUSPENDIDA</span>' : '<span style="font-size: 0.68rem; font-weight: 800; background: #dcfce7; color: #166534; padding: 2px 7px; border-radius: 5px;">ACTIVA</span>'}
                </div>
                <div style="font-size: 0.74rem; color: var(--text-muted); margin-top: 2px;">
                  ${s.grado} • Sección ${s.seccion} • Cód: <strong>${s.codigo_estudiante}</strong> • PIN: <strong>${s.pin_seguridad || '1234'}</strong>
                </div>
                <div style="font-size: 0.76rem; font-weight: 800; color: #0284c7; margin-top: 3px;">
                  Saldo: ₡${s.saldo_colones.toLocaleString('es-CR')} | Límite: ₡${s.limite_diario_colones.toLocaleString('es-CR')}/día
                </div>
              </div>
            </div>

            <div style="display: flex; gap: 8px; align-items: center; justify-content: flex-end; border-top: 1px dashed var(--border); padding-top: 8px; width: 100%; flex-wrap: wrap;">
              <button type="button" onclick="quickGoToRecarga(${s.id})" style="padding: 7px 12px; background: #10b981; color: white; border: none; border-radius: 8px; font-size: 0.76rem; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 4px;" title="Cargar dinero en caja a este estudiante">
                💵 Cargar Dinero
              </button>
              <a href="/carnet.html?id=${s.id}" target="_blank" style="padding: 7px 12px; background: #e0f2fe; color: #0369a1; border-radius: 8px; font-size: 0.76rem; font-weight: 800; text-decoration: none;" title="Ver e Imprimir Carné Físico">
                🖨️ Carné
              </a>
              <button type="button" onclick="toggleBlockCard(${s.id}, ${isBlocked ? 0 : 1})" style="padding: 7px 14px; background: ${isBlocked ? '#10b981' : '#ef4444'}; color: white; border: none; border-radius: 8px; font-size: 0.78rem; font-weight: 900; cursor: pointer;">
                ${isBlocked ? '✅ Desbloquear' : '⛔ Bloquear Tarjeta'}
              </button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

async function toggleBlockCard(studentId, newBlocked) {
  const actionText = newBlocked ? 'bloquear la tarjeta de este estudiante' : 'desbloquear la tarjeta';
  if (!confirm(`¿Estás seguro de que deseas ${actionText}?`)) return;

  try {
    const res = await fetch(`/api/admin/estudiantes/${studentId}/bloquear`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tarjeta_bloqueada: newBlocked })
    });
    if (!res.ok) throw new Error('Error actualizando estado de tarjeta');

    if (window.sounds) window.sounds.playCoin();
    await loadAdminData();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

function openNewStudentModal() {
  const modal = document.getElementById('modalNewStudent');
  if (modal) modal.style.display = 'flex';
}

function closeNewStudentModal(event) {
  if (event && event.target !== event.currentTarget) return;
  const modal = document.getElementById('modalNewStudent');
  if (modal) modal.style.display = 'none';
}

async function submitNewStudent(event) {
  if (event) event.preventDefault();

  const nombre = document.getElementById('newEstNombre').value.trim();
  const edad = parseInt(document.getElementById('newEstEdad').value, 10);
  const grado = document.getElementById('newEstGrado').value.trim();
  const seccion = document.getElementById('newEstSeccion').value.trim();
  const saldo = parseInt(document.getElementById('newEstSaldo').value, 10) || 0;
  const limite = parseInt(document.getElementById('newEstLimite').value, 10) || 3000;
  const alergias = document.getElementById('newEstAlergias').value.trim();
  const padre = document.getElementById('newEstPadre').value.trim();
  const tel = document.getElementById('newEstTel').value.trim();

  const btn = document.getElementById('btnSubmitNewStudent');
  btn.disabled = true;
  btn.textContent = 'Creando alumno y carné...';

  try {
    const res = await fetch('/api/admin/estudiantes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre_completo: nombre,
        edad,
        grado,
        seccion,
        saldo_inicial: saldo,
        limite_diario_colones: limite,
        alergias,
        padre_nombre: padre,
        padre_telefono: tel
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (window.sounds) window.sounds.playSuccess();
    alert(`🎉 ¡Estudiante Creado con Éxito!\nNombre: ${data.nombre_completo}\nCódigo: ${data.codigo_estudiante}\nQR Token: ${data.qr_token}`);

    closeNewStudentModal();
    document.getElementById('formNewStudent').reset();
    await loadAdminData();
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    alert(`❌ Error al crear estudiante: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '✅ Guardar y Generar Carné';
  }
}

// ==========================================
// BUSCADOR INTELIGENTE Y RECARGA EN CAJA (ADMIN)
// ==========================================

function setupAdminSmartSearch() {
  if (students && students.length > 0) {
    populateAdminRecargaStudents(students);
  }
  const input = document.getElementById('inputAdminSearchStudent');
  if (input && !input.dataset.listenerBound) {
    input.dataset.listenerBound = 'true';
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = input.value.trim();
        if (val) {
          handleAdminQrDetected(val);
        }
      }
    });
  }
}

function populateAdminRecargaStudents(list) {
  const sel = document.getElementById('adminRecargaStudentSelect');
  if (sel) {
    sel.innerHTML = '<option value="">-- Seleccionar estudiante --</option>' + (list || []).map(s => `
      <option value="${s.id}">${s.nombre_completo} (Saldo actual: ₡${(s.saldo_colones || 0).toLocaleString('es-CR')})</option>
    `).join('');
    if (adminSelectedStudent) {
      sel.value = String(adminSelectedStudent.id);
    } else {
      sel.value = '';
    }
  }
}

function onAdminSearchFocus() {
  const input = document.getElementById('inputAdminSearchStudent');
  const q = (input ? input.value : '').trim();
  if (q.length > 0) {
    onAdminSearchStudent(q);
  } else {
    // Al hacer clic o focus, mostrar la lista de estudiantes disponibles de inmediato
    renderAdminSearchDropdown(students || []);
  }
}

function onAdminSearchStudent(query) {
  const q = (query || '').trim().toLowerCase();
  const dropdown = document.getElementById('adminSearchResultsDropdown');
  const btnClear = document.getElementById('btnClearAdminSearch');

  if (btnClear) btnClear.style.display = q.length > 0 ? 'flex' : 'none';
  if (!dropdown) return;

  if (q.length === 0) {
    renderAdminSearchDropdown(students || []);
    return;
  }

  const results = (students || []).filter(s => {
    const nombre = (s.nombre_completo || '').toLowerCase();
    const codigo = (s.codigo_estudiante || '').toLowerCase();
    const grado = `${s.grado || ''} ${s.seccion || ''}`.toLowerCase();
    return nombre.includes(q) || codigo.includes(q) || grado.includes(q);
  });

  if (results.length === 0) {
    dropdown.innerHTML = `
      <div style="padding: 16px 12px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        ❌ No se encontró ningún estudiante con "<strong>${query}</strong>"
        <div style="margin-top: 6px; font-size: 0.74rem;">Intenta con el primer nombre, apellidos o carné (ej: EST-2026-001)</div>
      </div>
    `;
    dropdown.style.display = 'block';
    return;
  }

  renderAdminSearchDropdown(results, q);
}

function renderAdminSearchDropdown(list, query = '') {
  const dropdown = document.getElementById('adminSearchResultsDropdown');
  if (!dropdown) return;

  const displayList = (list || []).slice(0, 12);
  dropdown.innerHTML = `
    <div style="padding: 6px 12px; background: #f8fafc; border-bottom: 1px solid var(--border); font-size: 0.72rem; font-weight: 800; color: var(--text-muted); display: flex; justify-content: space-between; align-items: center;">
      <span>${query ? `🔍 Resultados para "${query}" (${list.length})` : `👥 Estudiantes Registrados (${list.length})`}:</span>
      <span style="color: #0284c7;">${displayList.length < list.length ? `Mostrando primeros ${displayList.length}` : 'Todos'}</span>
    </div>
    ${displayList.map(s => {
      const isSelected = adminSelectedStudent && adminSelectedStudent.id === s.id;
      return `
        <div class="admin-search-item ${isSelected ? 'selected' : ''}" onclick="selectAdminStudent(${s.id}, true)">
          <img src="${s.foto_url || '/img/avatar_default.png'}" style="width: 38px; height: 38px; border-radius: 50%; object-fit: cover; border: 2px solid ${isSelected ? '#0284c7' : '#cbd5e1'}; flex-shrink: 0;">
          <div style="min-width: 0; flex: 1;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <strong style="font-size: 0.9rem; color: var(--text-main); display: block; word-break: break-word;">${s.nombre_completo}</strong>
              ${isSelected ? '<span style="font-size: 0.62rem; font-weight: 900; background: #0284c7; color: white; padding: 1px 5px; border-radius: 4px;">ACTUAL</span>' : ''}
              ${s.tarjeta_bloqueada ? '<span style="font-size: 0.62rem; font-weight: 900; background: #fee2e2; color: #dc2626; padding: 1px 5px; border-radius: 4px;">BLOQUEADA</span>' : ''}
            </div>
            <span style="font-size: 0.73rem; color: var(--text-muted);">${s.grado} - Sec. ${s.seccion} • Cód: <strong style="color: #0284c7;">${s.codigo_estudiante}</strong></span>
          </div>
          <div style="text-align: right; flex-shrink: 0;">
            <span style="font-size: 0.65rem; color: var(--text-muted); display: block; text-transform: uppercase;">Saldo</span>
            <strong style="font-size: 0.95rem; color: #10b981;">₡${(s.saldo_colones || 0).toLocaleString('es-CR')}</strong>
          </div>
        </div>
      `;
    }).join('')}
  `;
  dropdown.style.display = 'block';
}

function clearAdminSearchStudent() {
  const input = document.getElementById('inputAdminSearchStudent');
  const btnClear = document.getElementById('btnClearAdminSearch');
  const dropdown = document.getElementById('adminSearchResultsDropdown');
  if (input) {
    input.value = '';
    input.focus();
  }
  if (btnClear) btnClear.style.display = 'none';
  if (dropdown) {
    dropdown.style.display = 'none';
    dropdown.innerHTML = '';
  }
}

function focusAdminSearch() {
  const input = document.getElementById('inputAdminSearchStudent');
  if (input) {
    input.value = '';
    input.focus();
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    onAdminSearchFocus();
  }
}

function quickGoToRecarga(studentId) {
  switchAdminTab('recarga');
  selectAdminStudent(studentId, true);
  const montoInput = document.getElementById('adminRecargaMonto');
  if (montoInput) {
    setTimeout(() => {
      montoInput.focus();
      montoInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
  }
}

function filterAdminStudentsTab2(query) {
  const q = (query || '').toLowerCase().trim();
  if (!q) {
    renderAdminStudents(students);
    return;
  }
  const filtered = (students || []).filter(s => {
    return (s.nombre_completo || '').toLowerCase().includes(q) ||
           (s.codigo_estudiante || '').toLowerCase().includes(q) ||
           `${s.grado || ''} ${s.seccion || ''}`.toLowerCase().includes(q);
  });
  renderAdminStudents(filtered);
}

function onAdminSelectChange(studentId) {
  selectAdminStudent(parseInt(studentId, 10), true);
}

function clearAdminSelectedStudent() {
  adminSelectedStudent = null;
  const sel = document.getElementById('adminRecargaStudentSelect');
  if (sel) sel.value = '';

  const wrap = document.getElementById('adminSelectedStudentWrap');
  const fields = document.getElementById('adminRecargaFormFields');
  const searchInput = document.getElementById('inputAdminSearchStudent');
  const btnClear = document.getElementById('btnClearAdminSearch');

  if (wrap) wrap.style.display = 'none';
  if (fields) {
    fields.style.opacity = '0.45';
    fields.style.pointerEvents = 'none';
  }
  if (searchInput) searchInput.value = '';
  if (btnClear) btnClear.style.display = 'none';

  const montoInput = document.getElementById('adminRecargaMonto');
  if (montoInput) montoInput.value = '';
  const descInput = document.getElementById('adminRecargaDescripcion');
  if (descInput) descInput.value = '';
}

function selectAdminStudent(studentOrId, updateSearchInput = false) {
  let student = null;
  if (typeof studentOrId === 'object' && studentOrId !== null) {
    student = studentOrId;
  } else {
    const id = parseInt(studentOrId, 10);
    student = (students || []).find(s => s.id === id);
  }
  if (!student) return;

  adminSelectedStudent = student;

  const sel = document.getElementById('adminRecargaStudentSelect');
  if (sel) sel.value = String(student.id);

  const wrap = document.getElementById('adminSelectedStudentWrap');
  const fields = document.getElementById('adminRecargaFormFields');

  if (wrap) wrap.style.display = 'block';
  if (fields) {
    fields.style.opacity = '1';
    fields.style.pointerEvents = 'auto';
  }

  const avatar = document.getElementById('adminSelectedAvatar');
  const name = document.getElementById('adminSelectedName');
  const statusBadge = document.getElementById('adminSelectedStatusBadge');
  const meta = document.getElementById('adminSelectedMeta');
  const balance = document.getElementById('adminSelectedBalance');
  const searchInput = document.getElementById('inputAdminSearchStudent');
  const dropdown = document.getElementById('adminSearchResultsDropdown');
  const btnClear = document.getElementById('btnClearAdminSearch');

  if (avatar) avatar.src = student.foto_url || '/img/avatar_default.png';
  if (name) name.textContent = student.nombre_completo;
  if (statusBadge) {
    if (student.tarjeta_bloqueada) {
      statusBadge.textContent = 'BLOQUEADA';
      statusBadge.style.background = '#fee2e2';
      statusBadge.style.color = '#dc2626';
    } else {
      statusBadge.textContent = 'ACTIVA';
      statusBadge.style.background = '#dcfce7';
      statusBadge.style.color = '#166534';
    }
  }
  if (meta) meta.textContent = `${student.grado} - Sección ${student.seccion} • Cód: ${student.codigo_estudiante}`;
  if (balance) balance.textContent = `₡${(student.saldo_colones || 0).toLocaleString('es-CR')}`;

  if (searchInput) {
    if (updateSearchInput) {
      searchInput.value = student.nombre_completo;
      if (btnClear) btnClear.style.display = 'flex';
    } else {
      searchInput.value = '';
      if (btnClear) btnClear.style.display = 'none';
    }
  }
  if (dropdown) dropdown.style.display = 'none';

  if (updateSearchInput) {
    const montoInput = document.getElementById('adminRecargaMonto');
    if (montoInput) {
      setTimeout(() => {
        montoInput.focus();
      }, 120);
    }
  }
}

// Cierre automático del dropdown al hacer clic fuera del buscador
document.addEventListener('click', (e) => {
  const container = document.querySelector('.admin-search-container');
  const dropdown = document.getElementById('adminSearchResultsDropdown');
  if (container && dropdown && !container.contains(e.target)) {
    dropdown.style.display = 'none';
  }
});

// PARSEADOR INTELIGENTE DE TOKENS Y CÓDIGOS QR
function parseScannedStudentToken(raw) {
  if (!raw) return '';
  let str = String(raw).trim();
  str = str.replace(/^["'`]+|["'`]+$/g, '').trim();

  // Si viene en formato JSON
  if (str.startsWith('{') && str.endsWith('}')) {
    try {
      const obj = JSON.parse(str);
      str = obj.qr_token || obj.token || obj.codigo_estudiante || obj.codigo || obj.id || str;
    } catch (e) {}
  }

  // Si viene como URL o ruta
  if (typeof str === 'string' && (str.includes('http://') || str.includes('https://') || str.includes('carnet.html') || str.includes('/'))) {
    const matchId = str.match(/[?&]id=(\d+)/i);
    if (matchId) return matchId[1];

    const matchParam = str.match(/[?&](?:qr|token|code)=([^&#]+)/i);
    if (matchParam) return decodeURIComponent(matchParam[1]).trim();

    const parts = str.split(/[/?#]/).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && !last.endsWith('.html') && !last.includes('=')) {
      return decodeURIComponent(last).trim();
    }
  }
  return String(str).trim();
}

// ESCANEO QR CON CÁMARA EN MOSTRADOR DE SODA (ADMIN)
let adminScanFacingMode = 'environment';
let isScanAdminLoopRunning = false;
let isProcessingAdminScan = false;

function openAdminScanQrModal() {
  const modal = document.getElementById('modalAdminScanQr');
  const statusEl = document.getElementById('adminScanModalStatus');
  const manualInput = document.getElementById('inputAdminScanManualCode');
  if (manualInput) manualInput.value = '';
  if (modal) modal.style.display = 'flex';
  if (statusEl) {
    statusEl.textContent = '📷 Enfoca el código QR del carné';
    statusEl.style.color = '#0284c7';
    statusEl.style.background = '#e0f2fe';
  }
  startScanAdminCamera();
}

function closeAdminScanQrModal(event) {
  if (event && event.target && event.target.id !== 'modalAdminScanQr') {
    return;
  }
  stopScanAdminCamera();
  const modal = document.getElementById('modalAdminScanQr');
  if (modal) modal.style.display = 'none';
}

async function toggleAdminCameraFacing() {
  adminScanFacingMode = (adminScanFacingMode === 'environment') ? 'user' : 'environment';
  await startScanAdminCamera();
}

async function submitAdminScanManualCode() {
  const input = document.getElementById('inputAdminScanManualCode');
  const val = input ? input.value.trim() : '';
  if (!val) {
    alert('Por favor digita el carné o código del estudiante');
    if (input) input.focus();
    return;
  }
  await handleAdminQrDetected(val);
}

async function startScanAdminCamera() {
  stopScanAdminCamera();
  const video = document.getElementById('videoAdminScan');
  const canvas = document.getElementById('canvasAdminScan');
  const statusEl = document.getElementById('adminScanModalStatus');
  if (!video || !canvas) return;

  try {
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.setAttribute('autoplay', 'true');

    const constraintConfigs = [
      { video: { facingMode: { ideal: adminScanFacingMode }, width: { ideal: 1280 } }, audio: false },
      { video: { facingMode: { ideal: adminScanFacingMode }, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
      { video: { facingMode: adminScanFacingMode }, audio: false },
      { video: true, audio: false }
    ];

    let stream = null;
    let lastErr = null;
    for (const c of constraintConfigs) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(c);
        if (stream) break;
      } catch (errAttempt) {
        lastErr = errAttempt;
      }
    }

    if (!stream) {
      throw lastErr || new Error('No se pudo acceder al lente de la cámara');
    }

    scanAdminStream = stream;
    video.srcObject = scanAdminStream;

    await new Promise((resolve) => {
      if (video.readyState >= 1) resolve();
      else {
        video.onloadedmetadata = () => resolve();
        setTimeout(resolve, 800);
      }
    });

    try {
      await video.play();
    } catch (e) {
      console.warn('Play video diferido:', e);
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    isScanAdminLoopRunning = true;
    isProcessingAdminScan = false;

    async function scanFrame() {
      if (!isScanAdminLoopRunning || !scanAdminStream) return;

      if (!isProcessingAdminScan) {
        const detected = await detectQrFromMedia(video, canvas, ctx);
        if (detected && !isProcessingAdminScan) {
          isProcessingAdminScan = true;
          if (statusEl) {
            statusEl.textContent = '⚡ ¡Código detectado! Verificando...';
            statusEl.style.color = '#166534';
            statusEl.style.background = '#dcfce7';
          }

          handleAdminQrDetected(detected).then(success => {
            if (!success) {
              setTimeout(() => {
                isProcessingAdminScan = false;
                if (statusEl && isScanAdminLoopRunning) {
                  statusEl.textContent = '📷 Enfoca el código QR del carné';
                  statusEl.style.color = '#0284c7';
                  statusEl.style.background = '#e0f2fe';
                }
              }, 1500);
            }
          });
        }
      }

      if (isScanAdminLoopRunning) {
        scanAdminAnimId = requestAnimationFrame(scanFrame);
      }
    }

    scanAdminAnimId = requestAnimationFrame(scanFrame);
  } catch (err) {
    console.warn('Cámara de mostrador no disponible:', err);
    if (statusEl) {
      statusEl.textContent = '⚠️ Cámara no disponible. Digita el carné abajo o búscalo arriba.';
      statusEl.style.color = '#dc2626';
      statusEl.style.background = '#fee2e2';
    }
  }
}

function stopScanAdminCamera() {
  isScanAdminLoopRunning = false;
  isProcessingAdminScan = false;
  if (scanAdminAnimId) {
    cancelAnimationFrame(scanAdminAnimId);
    scanAdminAnimId = null;
  }
  if (scanAdminStream) {
    try {
      scanAdminStream.getTracks().forEach(t => t.stop());
    } catch (e) {}
    scanAdminStream = null;
  }
  const video = document.getElementById('videoAdminScan');
  if (video) {
    video.srcObject = null;
  }
}

async function handleAdminQrDetected(token) {
  const statusEl = document.getElementById('adminScanModalStatus');
  const modal = document.getElementById('modalAdminScanQr');

  if (window.sounds) window.sounds.playBeep();

  const parsed = parseScannedStudentToken(token);
  const clean = parsed.toLowerCase();

  if (statusEl) {
    statusEl.textContent = '⏳ Verificando estudiante...';
    statusEl.style.color = '#0284c7';
    statusEl.style.background = '#e0f2fe';
  }

  // 1. Buscar en memoria local primero
  let student = (students || []).find(s => 
    (s.qr_token && s.qr_token.toLowerCase() === clean) ||
    (s.codigo_estudiante && s.codigo_estudiante.toLowerCase() === clean) ||
    (String(s.id) === parsed)
  );

  // 2. Si no se encontró en cache local, buscar en el servidor
  if (!student) {
    try {
      const res = await fetch(`/api/estudiantes/qr/${encodeURIComponent(parsed)}`);
      if (res.ok) {
        student = await res.json();
      }
    } catch (fetchErr) {
      console.warn('Error buscando en servidor:', fetchErr);
    }
  }

  // 3. Fallback con token original sin parsear
  if (!student && parsed !== token) {
    try {
      const res = await fetch(`/api/estudiantes/qr/${encodeURIComponent(String(token).trim())}`);
      if (res.ok) {
        student = await res.json();
      }
    } catch (e) {}
  }

  // 4. Fallback si el usuario digitó carné o nombre parcial
  if (!student) {
    try {
      const resAll = await fetch('/api/estudiantes');
      if (resAll.ok) {
        const allEst = await resAll.json();
        students = allEst;
        student = (students || []).find(s => 
          (s.qr_token && s.qr_token.toLowerCase() === clean) ||
          (s.codigo_estudiante && s.codigo_estudiante.toLowerCase() === clean) ||
          (s.nombre_completo && s.nombre_completo.toLowerCase().includes(clean)) ||
          (String(s.id) === parsed)
        );
      }
    } catch (e) {}
  }

  // 5. Procesar resultado
  if (student) {
    const idx = (students || []).findIndex(s => s.id === student.id);
    if (idx >= 0) {
      students[idx] = student;
    } else {
      students.push(student);
    }

    populateAdminRecargaStudents(students);
    selectAdminStudent(student, true);

    // Apagar cámara y cerrar modal
    stopScanAdminCamera();
    if (modal) modal.style.display = 'none';

    if (window.sounds) window.sounds.playSuccess();
    return true;
  } else {
    // Si no se encontró, NO cerrar el modal: dar feedback visual claro
    if (window.sounds) window.sounds.playError();
    if (statusEl) {
      statusEl.textContent = `❌ Código no reconocido: "${parsed.slice(0, 20)}". Enfoca de nuevo.`;
      statusEl.style.color = '#dc2626';
      statusEl.style.background = '#fee2e2';
    }
    return false;
  }
}

function setAdminRecargaPreset(amt) {
  const input = document.getElementById('adminRecargaMonto');
  if (input) input.value = amt;
  if (window.sounds) window.sounds.playTap();
}

async function submitAdminManualRecharge() {
  const sel = document.getElementById('adminRecargaStudentSelect');
  const inputMonto = document.getElementById('adminRecargaMonto');
  const inputDesc = document.getElementById('adminRecargaDescripcion');
  const btn = document.getElementById('btnAdminSubmitRecarga');

  let studentId = adminSelectedStudent ? adminSelectedStudent.id : (sel ? parseInt(sel.value, 10) : null);
  const monto = parseInt(inputMonto ? inputMonto.value : 0, 10);
  const descripcion = inputDesc ? inputDesc.value.trim() : '';

  if (!studentId) {
    alert('Por favor selecciona un estudiante antes de aplicar la recarga.');
    return;
  }

  if (isNaN(monto) || monto <= 0) {
    alert('Ingresa un monto válido mayor a ₡0 para recargar.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Procesando recarga en caja...';

  try {
    const res = await fetch(`/api/admin/estudiantes/${studentId}/recarga-manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        monto,
        descripcion: descripcion || 'Pago en efectivo en mostrador de soda',
        metodo: 'Efectivo en mostrador'
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (window.sounds) window.sounds.playSuccess();
    alert(`💰 ${data.mensaje}\nNuevo Saldo: ₡${data.saldo_nuevo.toLocaleString('es-CR')}`);

    inputMonto.value = '';
    if (inputDesc) inputDesc.value = '';

    // Actualizar datos del estudiante en cache y banner
    if (adminSelectedStudent && adminSelectedStudent.id === studentId) {
      adminSelectedStudent.saldo_colones = data.saldo_nuevo;
      const balanceEl = document.getElementById('adminSelectedBalance');
      if (balanceEl) balanceEl.textContent = `₡${data.saldo_nuevo.toLocaleString('es-CR')}`;
    }

    await loadAdminData();
    populateAdminRecargaStudents(students);
    clearAdminSelectedStudent();
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    alert(`❌ Error al recargar: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>💰</span> Aplicar Recarga Inmediata';
  }
}

// ==========================================
// HISTORIAL DE MOVIMIENTOS Y REVERSIONES (ADMIN / CAJERO)
// ==========================================

let adminMovimientosData = [];
let currentMovFilter = 'all';

async function loadAdminMovimientos() {
  const container = document.getElementById('adminMovimientosList');
  if (!container) return;

  try {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 30px; font-size: 0.88rem;">
        ⏳ Cargando movimientos recientes...
      </div>
    `;

    const res = await fetch('/api/admin/movimientos?limit=100');
    if (!res.ok) throw new Error('Error al cargar movimientos desde el servidor');
    adminMovimientosData = await res.json();
    renderAdminMovimientos();
  } catch (err) {
    console.error('Error cargando movimientos:', err);
    container.innerHTML = `<div style="text-align: center; color: #ef4444; padding: 25px; font-weight: 700;">⚠️ Error al cargar el historial: ${err.message}</div>`;
  }
}

function setMovFilter(filter) {
  currentMovFilter = filter;
  const btnAll = document.getElementById('btnFilterMovAll');
  const btnRecargas = document.getElementById('btnFilterMovRecargas');
  const btnCobros = document.getElementById('btnFilterMovCobros');

  [btnAll, btnRecargas, btnCobros].forEach(b => {
    if (!b) return;
    b.style.background = 'transparent';
    b.style.color = '#64748b';
    b.style.boxShadow = 'none';
    b.style.fontWeight = '700';
  });

  const activeBtn = filter === 'recargas' ? btnRecargas : (filter === 'cobros' ? btnCobros : btnAll);
  if (activeBtn) {
    activeBtn.style.background = '#ffffff';
    activeBtn.style.color = '#0284c7';
    activeBtn.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)';
    activeBtn.style.fontWeight = '800';
  }

  renderAdminMovimientos();
  if (window.sounds) window.sounds.playTap();
}

function filterMovimientosUI() {
  renderAdminMovimientos();
}

function renderAdminMovimientos() {
  const container = document.getElementById('adminMovimientosList');
  if (!container) return;

  const searchInput = document.getElementById('inputSearchMovimientos');
  const search = searchInput ? searchInput.value.toLowerCase().trim() : '';

  let filtered = adminMovimientosData.filter(m => {
    // Filtro por tipo
    if (currentMovFilter === 'recargas') {
      if (m.monto_colones <= 0 || m.tipo === 'compra_mostrador' || m.tipo === 'preorden') return false;
    } else if (currentMovFilter === 'cobros') {
      if (m.monto_colones >= 0 && (m.tipo === 'recarga_manual' || m.tipo === 'recarga_sinpe')) return false;
    }

    // Filtro por texto de búsqueda
    if (search) {
      const matchName = (m.estudiante_nombre || '').toLowerCase().includes(search);
      const matchCode = (m.codigo_estudiante || '').toLowerCase().includes(search);
      const matchDesc = (m.descripcion || '').toLowerCase().includes(search);
      const matchTicket = (m.codigo_orden || '').toLowerCase().includes(search);
      if (!matchName && !matchCode && !matchDesc && !matchTicket) return false;
    }

    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 35px 20px; background: #f8fafc; border-radius: 14px; border: 1.5px dashed var(--border);">
        <span style="font-size: 2.2rem;">🔍</span>
        <p style="margin: 8px 0 2px 0; font-weight: 800; font-size: 0.95rem; color: var(--text-main);">No se encontraron movimientos</p>
        <span style="font-size: 0.78rem; color: var(--text-muted);">No hay registros que coincidan con el filtro o búsqueda actual.</span>
      </div>
    `;
    return;
  }

  const isCajero = currentUser && currentUser.rol === 'cajero';

  container.innerHTML = filtered.map(m => {
    const isPositive = m.monto_colones > 0;
    const isRevertida = m.revertida === 1;
    const isReversionOrRefund = m.tipo === 'reversion_recarga' || m.tipo === 'reembolso';

    // Determinar badge de tipo
    let tipoBadge = '';
    if (m.tipo === 'recarga_manual') {
      tipoBadge = `<span style="background: #dcfce7; color: #166534; font-size: 0.7rem; font-weight: 800; padding: 3px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;">💵 Recarga Efectivo</span>`;
    } else if (m.tipo === 'recarga_sinpe') {
      tipoBadge = `<span style="background: #e0f2fe; color: #0369a1; font-size: 0.7rem; font-weight: 800; padding: 3px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;">📲 Recarga SINPE</span>`;
    } else if (m.tipo === 'compra_mostrador' || m.tipo === 'preorden') {
      tipoBadge = `<span style="background: #fef3c7; color: #92400e; font-size: 0.7rem; font-weight: 800; padding: 3px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;">🥪 Cobro Soda</span>`;
    } else if (m.tipo === 'reversion_recarga') {
      tipoBadge = `<span style="background: #f3e8ff; color: #6b21a8; font-size: 0.7rem; font-weight: 800; padding: 3px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;">↩️ Reversión Recarga</span>`;
    } else if (m.tipo === 'reembolso') {
      tipoBadge = `<span style="background: #f3e8ff; color: #6b21a8; font-size: 0.7rem; font-weight: 800; padding: 3px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;">↩️ Reembolso Compra</span>`;
    } else {
      tipoBadge = `<span style="background: #f1f5f9; color: #475569; font-size: 0.7rem; font-weight: 800; padding: 3px 8px; border-radius: 6px;">${m.tipo.toUpperCase()}</span>`;
    }

    // Formato de hora
    let fechaHoraStr = m.fecha || '';
    try {
      const d = new Date(m.fecha.includes('Z') ? m.fecha : m.fecha.replace(' ', 'T') + 'Z');
      fechaHoraStr = d.toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' }) + ' • ' + d.toLocaleDateString('es-CR', { day: '2-digit', month: 'short' });
    } catch (e) {}

    // Monto formateado
    const absMonto = Math.abs(m.monto_colones);
    const montoDisplay = isPositive ? `+₡${absMonto.toLocaleString('es-CR')}` : `-₡${absMonto.toLocaleString('es-CR')}`;
    const montoColor = isPositive ? '#16a34a' : '#d97706';

    // Regla de 10 min para Cajero
    const minutos = parseFloat(m.minutos_transcurridos) || 0;
    const canRevertTime = !isCajero || minutos <= 10;

    // Botón de acción / Estado
    let actionHtml = '';
    if (isRevertida) {
      actionHtml = `
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="display: inline-flex; align-items: center; gap: 4px; background: #fee2e2; color: #991b1b; padding: 4px 9px; border-radius: 7px; font-size: 0.72rem; font-weight: 900; border: 1px solid #fca5a5;">
            ⛔ REVERTIDO
          </span>
          ${m.revertido_por_nombre ? `<span style="font-size: 0.68rem; color: var(--text-muted); font-weight: 700;">(${m.revertido_por_nombre})</span>` : ''}
        </div>
      `;
    } else if (isReversionOrRefund) {
      actionHtml = `
        <span style="display: inline-flex; align-items: center; background: rgba(100, 116, 139, 0.12); color: var(--text-muted); padding: 4px 10px; border-radius: 7px; font-size: 0.72rem; font-weight: 800;">
          Ajuste
        </span>
      `;
    } else if (!canRevertTime) {
      actionHtml = `
        <button type="button" disabled title="Han pasado más de 10 minutos. Esta reversión solo puede ser realizada por un Administrador." style="padding: 5px 10px; background: #e2e8f0; color: #64748b; border: 1px solid #cbd5e1; border-radius: 7px; font-size: 0.72rem; font-weight: 800; cursor: not-allowed; display: inline-flex; align-items: center; gap: 4px;">
          ⏳ Admin (+10m)
        </button>
      `;
    } else {
      const cleanName = (m.estudiante_nombre || '').replace(/'/g, "\\'");
      actionHtml = `
        <button type="button" onclick="revertirMovimientoAdmin(${m.id}, ${absMonto}, '${cleanName}', '${m.tipo}')" style="padding: 6px 14px; background: #fee2e2; color: #b91c1c; border: 1.5px solid #f87171; border-radius: 8px; font-size: 0.76rem; font-weight: 900; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; transition: all 0.2s; box-shadow: 0 1px 3px rgba(239, 68, 68, 0.15);" onmouseover="this.style.background='#fca5a5'" onmouseout="this.style.background='#fee2e2'">
          <span>↩️</span> Revertir
        </button>
      `;
    }

    return `
      <div class="admin-mov-card" style="background: ${isRevertida ? 'rgba(254, 242, 242, 0.45)' : 'var(--card-bg)'}; border: 1.5px solid ${isRevertida ? '#fecaca' : 'var(--border)'}; border-radius: 14px; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; opacity: ${isRevertida ? '0.85' : '1'}; transition: all 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
        
        <!-- FILA SUPERIOR: BADGE Y FECHA -->
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; border-bottom: 1px solid var(--border); padding-bottom: 8px; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 6px;">
            ${tipoBadge}
            <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 800;">#${m.id}</span>
          </div>
          <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">
            🕒 ${fechaHoraStr}
          </span>
        </div>

        <!-- FILA CENTRAL: ALUMNO Y DETALLES -->
        <div style="display: flex; align-items: center; gap: 12px; min-width: 0;">
          <img src="${m.estudiante_foto || '/img/avatar_default.png'}" style="width: 44px; height: 44px; border-radius: 50%; border: 2.5px solid ${isPositive ? '#10b981' : '#f59e0b'}; object-fit: cover; background: white; flex-shrink: 0;">
          <div style="min-width: 0; flex: 1;">
            <strong style="font-size: 0.98rem; color: var(--text-main); font-weight: 900; line-height: 1.25; display: block; word-break: normal; white-space: normal;">
              ${m.estudiante_nombre}
            </strong>
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px; display: flex; flex-wrap: wrap; gap: 4px; align-items: center;">
              <span style="font-weight: 800; color: #0284c7;">${m.codigo_estudiante}</span>
              ${(m.grado || m.seccion) ? `<span>• ${m.grado || ''} ${m.seccion ? 'Sec. ' + m.seccion : ''}</span>` : ''}
              ${m.codigo_orden ? `<span style="background: rgba(2, 132, 199, 0.1); color: #0284c7; padding: 1px 6px; border-radius: 4px; font-weight: 800; font-size: 0.7rem;">Ticket: ${m.codigo_orden}</span>` : ''}
            </div>
            ${m.descripcion ? `
              <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 4px; background: rgba(148, 163, 184, 0.08); padding: 3px 8px; border-radius: 6px; line-height: 1.35; display: inline-block;">
                📝 ${m.descripcion}
              </div>
            ` : ''}
          </div>
        </div>

        <!-- FILA INFERIOR: MONTO, SALDO POSTERIOR Y BOTÓN DE ACCIÓN -->
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; background: rgba(148, 163, 184, 0.07); border: 1px solid var(--border); border-radius: 10px; padding: 8px 12px; flex-wrap: wrap;">
          <div style="display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;">
            <span style="font-size: 1.15rem; font-weight: 900; color: ${montoColor}; line-height: 1.1;">
              ${montoDisplay}
            </span>
            <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 700;">
              Saldo posterior: <strong style="color: var(--text-main);">₡${(m.saldo_posterior || 0).toLocaleString('es-CR')}</strong>
            </span>
          </div>
          <div style="flex-shrink: 0;">
            ${actionHtml}
          </div>
        </div>

      </div>
    `;
  }).join('');
}

async function revertirMovimientoAdmin(transaccionId, monto, nombreEstudiante, tipo) {
  const esRecarga = tipo.includes('recarga') || tipo === 'transferencia_recibida';
  const accionTexto = esRecarga ? 'esta RECARGA errónea de dinero' : 'este COBRO de merienda';
  const efectoTexto = esRecarga
    ? `Se restarán ₡${monto.toLocaleString('es-CR')} del monedero del estudiante.`
    : `Se devolverán ₡${monto.toLocaleString('es-CR')} al monedero del estudiante y se restaurará el stock de los productos.`;

  const conf = confirm(
    `¿Estás seguro de revertir ${accionTexto}?\n\n` +
    `• Alumno: ${nombreEstudiante}\n` +
    `• Monto: ₡${monto.toLocaleString('es-CR')}\n\n` +
    `⚠️ ${efectoTexto}\n\n` +
    `¿Deseas continuar con la reversión?`
  );

  if (!conf) return;

  try {
    const res = await fetch(`/api/admin/movimientos/${transaccionId}/revertir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usuario_id: currentUser ? currentUser.id : null,
        usuario_rol: currentUser ? currentUser.rol : 'admin'
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (window.sounds) window.sounds.playSuccess();
    alert(`✅ Reversión Exitosa:\n${data.mensaje}`);

    await loadAdminMovimientos();
    await loadAdminData();
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    alert(`❌ No se pudo revertir el movimiento:\n${err.message}`);
  }
}

