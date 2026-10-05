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
    navigator.serviceWorker.register('/sw.js?v=7.0').then(reg => {
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

function showLoginView() {
  const viewLogin = document.getElementById('viewLogin');
  const viewAdmin = document.getElementById('viewAdmin');
  const appContainer = document.getElementById('appContainer');
  const bottomNav = document.getElementById('pwaBottomNav');

  if (viewLogin) viewLogin.style.display = 'flex';
  if (viewAdmin) viewAdmin.style.display = 'none';
  if (appContainer) appContainer.style.display = 'none';
  if (bottomNav) bottomNav.style.display = 'none';

  // Cerrar cualquier modal que pudiera estar abierto
  toggleParentPanel(false);
  closeCartModal();
  closeQrModal();
  closeTransferModal();
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
  const appContainer = document.getElementById('appContainer');
  const bottomNav = document.getElementById('pwaBottomNav');
  const navPadres = document.getElementById('pwaNavPadres');

  if (viewLogin) viewLogin.style.display = 'none';

  if (currentUser.rol === 'admin') {
    if (viewAdmin) viewAdmin.style.display = 'block';
    if (appContainer) appContainer.style.display = 'none';
    if (bottomNav) bottomNav.style.display = 'none';
    const adminNameEl = document.getElementById('adminLoggedName');
    if (adminNameEl) adminNameEl.textContent = `${currentUser.nombre} (Administrador)`;
    await loadAdminData();
  } else if (currentUser.rol === 'padre') {
    if (viewAdmin) viewAdmin.style.display = 'none';
    if (appContainer) appContainer.style.display = 'block';
    if (bottomNav) bottomNav.style.display = 'flex';
    if (navPadres) navPadres.style.display = 'flex';
    
    // Mostrar botón de acceso al portal de padres
    const btnPadres = document.getElementById('btnModePadres');
    if (btnPadres) btnPadres.style.display = 'inline-block';

    await loadInitialData();
    setupParentPortalChildren();
    toggleParentPanel(true);
  } else {
    // Estudiante: SEGURIDAD ESTRICTA - Ocultar botón de padres
    if (viewAdmin) viewAdmin.style.display = 'none';
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

  // Límite diario
  document.getElementById('dailyLimitText').textContent = `₡${currentStudent.limite_diario_colones.toLocaleString('es-CR')}`;
  document.getElementById('dailyAvailableText').textContent = `Disponible hoy: ₡${currentStudent.disponible_hoy.toLocaleString('es-CR')}`;

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
    const stockBadge = prod.control_stock === 1
      ? (isOutOfStock 
          ? '<span class="badge-out-of-stock">🚫 AGOTADO</span>' 
          : `<span style="font-size: 0.68rem; font-weight: 800; color: #166534; background: #dcfce7; padding: 2px 6px; border-radius: 4px;">🟢 ${prod.stock} disponibles</span>`)
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
  // SEGURIDAD: Un estudiante no tiene acceso al portal de padres
  if (currentUser && currentUser.rol === 'estudiante') {
    const modalPadres = document.getElementById('modalPadres');
    if (modalPadres) modalPadres.style.display = 'none';
    resetPwaNavActive();
    return;
  }
  if (e && e.target !== e.currentTarget) return;
  const modalPadres = document.getElementById('modalPadres');
  if (modalPadres) modalPadres.style.display = show ? 'flex' : 'none';
  if (!show) resetPwaNavActive();
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

// SSE en tiempo real para eventos de la soda y monederos
function initStudentSSE() {
  const sse = new EventSource('/api/events');

  sse.addEventListener('transferencia_realizada', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (currentStudent && data.receptor.id === currentStudent.id) {
        if (window.sounds) window.sounds.playCoin();
        alert(`🔔 ¡Te pasaron plata!\n${data.emisor.nombre} te transfirió ₡${data.monto.toLocaleString('es-CR')}.\nMotivo: ${data.motivo}`);
        selectStudent(currentStudent.id);
      }
    } catch (err) {}
  });

  sse.addEventListener('recarga_exitosa', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (currentStudent && data.estudiante_id === currentStudent.id) {
        if (window.sounds) window.sounds.playCoin();
        selectStudent(currentStudent.id);
      }
      if (currentUser && currentUser.rol === 'admin') {
        loadAdminData();
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
      if (currentUser && currentUser.rol === 'admin') {
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
      if (currentStudent && currentStudent.id === data.id) {
        selectStudent(currentStudent.id);
      }
      if (currentUser && currentUser.rol === 'admin') {
        loadAdminData();
      }
    } catch (err) {}
  });
}

// ==========================================
// FUNCIONES DEL PORTAL DE PADRES (HIJOS Y CREDENCIALES)
// ==========================================

function setupParentPortalChildren() {
  const box = document.getElementById('parentChildSelectorBox');
  const sel = document.getElementById('parentChildSelect');
  if (!box || !sel) return;

  if (currentUser && currentUser.hijos && currentUser.hijos.length > 0) {
    box.style.display = 'block';
    sel.innerHTML = currentUser.hijos.map(h => `
      <option value="${h.id}">${h.nombre_completo} (${h.grado} - Sección ${h.seccion})</option>
    `).join('');

    onParentChildSelect(currentUser.hijos[0].id);
  } else if (students.length > 0) {
    box.style.display = 'block';
    sel.innerHTML = students.slice(0, 2).map(h => `
      <option value="${h.id}">${h.nombre_completo} (${h.grado} - Sección ${h.seccion})</option>
    `).join('');
    onParentChildSelect(students[0].id);
  }
}

async function onParentChildSelect(studentId) {
  await selectStudent(studentId);
}

async function saveParentChildAccess() {
  if (!currentStudent) return;
  const pin = document.getElementById('inputParentNewPin').value.trim();
  const pass = document.getElementById('inputParentNewPass').value.trim();

  if (!pin && !pass) {
    alert('Ingresa al menos un nuevo PIN o una nueva contraseña para actualizar.');
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
        estudiante_id: currentStudent.id,
        nuevo_pin: pin || undefined,
        nuevo_password: pass || undefined
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (window.sounds) window.sounds.playSuccess();
    alert(`✅ ¡Credenciales actualizadas!\n${data.mensaje}`);
    document.getElementById('inputParentNewPin').value = '';
    document.getElementById('inputParentNewPass').value = '';
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    alert(`❌ Error actualizando credenciales: ${err.message}`);
  }
}

// ==========================================
// PANEL DE ADMINISTRACIÓN DE LA SODA
// ==========================================

function switchAdminTab(tabName) {
  const tabs = ['inventario', 'estudiantes', 'recarga'];
  tabs.forEach(t => {
    const btn = document.getElementById(`btnTabAdmin${t.charAt(0).toUpperCase() + t.slice(1)}`);
    const content = document.getElementById(`adminTabContent${t.charAt(0).toUpperCase() + t.slice(1)}`);
    if (btn) btn.classList.toggle('active', t === tabName);
    if (content) content.style.display = (t === tabName) ? 'block' : 'none';
  });

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

            <div style="display: flex; gap: 8px; align-items: center; justify-content: flex-end; border-top: 1px dashed var(--border); padding-top: 8px; width: 100%;">
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

function populateAdminRecargaStudents(list) {
  const sel = document.getElementById('adminRecargaStudentSelect');
  if (!sel) return;
  sel.innerHTML = list.map(s => `
    <option value="${s.id}">${s.nombre_completo} (Saldo actual: ₡${s.saldo_colones.toLocaleString('es-CR')})</option>
  `).join('');
}

function setAdminRecargaPreset(amt) {
  const input = document.getElementById('adminRecargaMonto');
  if (input) input.value = amt;
}

async function submitAdminManualRecharge() {
  const sel = document.getElementById('adminRecargaStudentSelect');
  const inputMonto = document.getElementById('adminRecargaMonto');
  const inputDesc = document.getElementById('adminRecargaDescripcion');
  const btn = document.getElementById('btnAdminSubmitRecarga');

  if (!sel || !inputMonto) return;

  const studentId = parseInt(sel.value, 10);
  const monto = parseInt(inputMonto.value, 10);
  const descripcion = inputDesc ? inputDesc.value.trim() : '';

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
        descripcion,
        metodo: 'Efectivo en mostrador'
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (window.sounds) window.sounds.playSuccess();
    alert(`💰 ${data.mensaje}\nNuevo Saldo: ₡${data.saldo_nuevo.toLocaleString('es-CR')}`);

    inputMonto.value = '';
    if (inputDesc) inputDesc.value = '';
    await loadAdminData();
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    alert(`❌ Error al recargar: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>💰</span> Aplicar Recarga Inmediata';
  }
}
