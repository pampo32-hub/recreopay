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
let adminStaffList = [];

let CLOUDFLARE_TUNNEL_URL = 'https://recreopay.gammapos.app';

// Helper universal para iniciales de estudiantes (ej. Mateo Alvarado -> MA, Sofía Jiménez -> SJ)
function getStudentInitials(fullName) {
  if (!fullName || typeof fullName !== 'string') return 'ES';
  const clean = fullName.trim().replace(/\s+/g, ' ');
  const parts = clean.split(' ');
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
}

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
  if (typeof applyCardTheme === 'function' && typeof getSavedCardTheme === 'function') {
    applyCardTheme(getSavedCardTheme());
  }
  checkHttpsEnvironment();

  // Registrar Service Worker para PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js?v=8.5').then(reg => {
      if ('Notification' in window && Notification.permission === 'granted') {
        subscribeDeviceToWebPush().catch(() => {});
      }
    }).catch(err => console.log('SW error:', err));
  }

  // Verificar si hay sesión activa guardada
  const storedUser = localStorage.getItem('sibopay_user') || localStorage.getItem('recreopay_user');
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

  const transferPinEl = document.getElementById('inputTransferPin');
  if (transferPinEl) {
    transferPinEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        executeP2PTransfer();
      }
    });
    transferPinEl.addEventListener('input', (e) => {
      if (window.sounds && e.data) {
        window.sounds.playTap();
      }
    });
  }

  const customAmountEl = document.getElementById('inputTransferCustomAmount');
  if (customAmountEl) {
    customAmountEl.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      document.querySelectorAll('#transferStepConfirm .transfer-amount-btn, #transferStepConfirm .mode-btn').forEach(b => b.classList.remove('active'));
      if (val && val > 0) {
        currentTransferAmount = val;
        updateTransferConfirmButton(val);
        const match = document.getElementById(`btnTransfer${val}`);
        if (match) match.classList.add('active');
      } else {
        currentTransferAmount = 0;
        updateTransferConfirmButton(0);
      }
    });
  }
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
  const viewDeveloper = document.getElementById('viewDeveloper');
  const appContainer = document.getElementById('appContainer');
  const bottomNav = document.getElementById('pwaBottomNav');

  if (viewLogin) viewLogin.style.display = 'flex';
  if (viewAdmin) viewAdmin.style.display = 'none';
  if (viewPadres) viewPadres.style.display = 'none';
  if (viewDeveloper) viewDeveloper.style.display = 'none';
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

let currentLoginRole = 'padre';

function selectLoginRole(role) {
  currentLoginRole = role;
  const cardPadre = document.getElementById('loginRoleCardPadre');
  const cardEstudiante = document.getElementById('loginRoleCardEstudiante');
  const cardPersonal = document.getElementById('loginRoleCardPersonal');

  if (cardPadre) cardPadre.classList.toggle('selected', role === 'padre');
  if (cardEstudiante) cardEstudiante.classList.toggle('selected', role === 'estudiante');
  if (cardPersonal) cardPersonal.classList.toggle('selected', role === 'personal');

  const lblUser = document.getElementById('lblLoginUser');
  const inputUser = document.getElementById('loginUsername');
  const lblPass = document.getElementById('lblLoginPass');
  const inputPass = document.getElementById('loginPassword');
  const btnText = document.getElementById('lblBtnLoginText');

  if (role === 'estudiante') {
    if (lblUser) lblUser.textContent = 'Carné o Código de Estudiante:';
    if (inputUser) inputUser.placeholder = 'Ej: EST-2026-00001, mateo, sofia';
    if (lblPass) lblPass.textContent = 'PIN Escolar (4 dígitos) o Contraseña:';
    if (inputPass) inputPass.placeholder = 'Ej: 1234';
    if (btnText) btnText.textContent = 'Ingresar como Estudiante';
  } else if (role === 'personal') {
    if (lblUser) lblUser.textContent = 'Usuario de Soda o Admin:';
    if (inputUser) inputUser.placeholder = 'Ej: admin, cajero, soda';
    if (lblPass) lblPass.textContent = 'Contraseña:';
    if (inputPass) inputPass.placeholder = '••••••••';
    if (btnText) btnText.textContent = 'Ingresar al Sistema de Soda';
  } else {
    // Padre / Encargado
    if (lblUser) lblUser.textContent = 'Usuario o Teléfono del Padre:';
    if (inputUser) inputUser.placeholder = 'Ej: padre, carlos_papa o 8888-1122';
    if (lblPass) lblPass.textContent = 'Contraseña:';
    if (inputPass) inputPass.placeholder = '••••••••';
    if (btnText) btnText.textContent = 'Ingresar como Padre / Encargado';
  }

  if (window.sounds) window.sounds.playTap();
}

// Compatibilidad
function selectRegisterRole(role) {
  selectLoginRole(role);
}

async function handleRegisterPadreSubmit(event) {
  if (event) event.preventDefault();
  const nombre = document.getElementById('regNombre').value.trim();
  const telefono = document.getElementById('regTelefono').value.trim();
  const emailInput = document.getElementById('regEmail');
  const email = emailInput ? emailInput.value.trim() : '';
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
      body: JSON.stringify({ nombre, telefono, email, username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al registrar la cuenta');

    currentUser = {
      ...data.user,
      hijos: []
    };
    localStorage.setItem('sibopay_user', JSON.stringify(currentUser));
    localStorage.setItem('recreopay_user', JSON.stringify(currentUser));

    if (window.sounds) window.sounds.playSuccess();
    alert(`¡Bienvenido(a) a SiboPay, ${data.user.nombre}! Tu cuenta de padre fue creada exitosamente.`);
    await applyUserRoleSession();
  } catch (err) {
    if (errorMsg) {
      errorMsg.textContent = `${err.message}`;
      errorMsg.style.display = 'block';
    }
    if (window.sounds) window.sounds.playError();
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;"><circle cx="9" cy="7" r="3.5"/><path d="M3 20v-1.5A4.5 4.5 0 0 1 7.5 14h3A4.5 4.5 0 0 1 15 18.5V20"/><circle cx="17.5" cy="7.5" r="2.5"/><path d="M15 14a3.5 3.5 0 0 1 5.5 3v3"/></svg> Crear Cuenta de Padre y Entrar';
  }
}

function quickFillLogin(username, password) {
  if (username === 'mateo' || username === 'sofia') {
    selectLoginRole('estudiante');
  } else if (username === 'admin' || username === 'cajero' || username === 'dev') {
    selectLoginRole('personal');
  } else if (username === 'padre') {
    selectLoginRole('padre');
  }

  const inputUser = document.getElementById('loginUsername');
  const inputPass = document.getElementById('loginPassword');
  if (inputUser) inputUser.value = username;
  if (inputPass) inputPass.value = password;
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
    localStorage.setItem('sibopay_user', JSON.stringify(currentUser));
    localStorage.setItem('recreopay_user', JSON.stringify(currentUser));

    if (window.sounds) window.sounds.playSuccess();
    await applyUserRoleSession();
  } catch (err) {
    if (errorMsg) {
      errorMsg.textContent = `${err.message}`;
      errorMsg.style.display = 'block';
    }
    if (window.sounds) window.sounds.playError();
  } finally {
    submitBtn.disabled = false;
    const btnLabel = currentLoginRole === 'estudiante' 
      ? 'Ingresar como Estudiante' 
      : currentLoginRole === 'personal' 
        ? 'Ingresar al Sistema de Soda' 
        : 'Ingresar como Padre / Encargado';
    submitBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" x2="3" y1="12" y2="12"/></svg> <span id="lblBtnLoginText">${btnLabel}</span>`;
  }
}

async function applyUserRoleSession() {
  if (!currentUser) return showLoginView();

  const viewLogin = document.getElementById('viewLogin');
  const viewAdmin = document.getElementById('viewAdmin');
  const viewPadres = document.getElementById('viewPadres');
  const viewDeveloper = document.getElementById('viewDeveloper');
  const appContainer = document.getElementById('appContainer');
  const bottomNav = document.getElementById('pwaBottomNav');
  const navPadres = document.getElementById('pwaNavPadres');

  if (viewLogin) viewLogin.style.display = 'none';

  if (currentUser.rol === 'developer') {
    if (viewDeveloper) viewDeveloper.style.display = 'block';
    if (viewAdmin) viewAdmin.style.display = 'none';
    if (viewPadres) viewPadres.style.display = 'none';
    if (appContainer) appContainer.style.display = 'none';
    if (bottomNav) bottomNav.style.display = 'none';

    const devNameEl = document.getElementById('devLoggedName');
    if (devNameEl) {
      devNameEl.textContent = `${currentUser.nombre} (${currentUser.username})`;
    }

    const btnDevAdmin = document.getElementById('btnAdminDevPanel');
    if (btnDevAdmin) btnDevAdmin.style.display = 'inline-flex';

    await loadInitialData();
    switchDevTab('usuarios');
    await loadDevUsuarios();
    await loadDevDisenos();
    await loadDevStats();
    return;
  }

  if (viewDeveloper) viewDeveloper.style.display = 'none';

  if (currentUser.rol === 'admin' || currentUser.rol === 'cajero' || currentUser.rol === 'vendedor') {
    if (viewAdmin) viewAdmin.style.display = 'block';
    if (viewPadres) viewPadres.style.display = 'none';
    if (appContainer) appContainer.style.display = 'none';
    if (bottomNav) bottomNav.style.display = 'none';
    const adminNameEl = document.getElementById('adminLoggedName');
    if (adminNameEl) {
      let badgeRol = 'Administrador';
      if (currentUser.rol === 'cajero') badgeRol = 'Cajero Soda';
      if (currentUser.rol === 'vendedor') badgeRol = 'Vendedor / Despacho';
      adminNameEl.textContent = `${currentUser.nombre} (${badgeRol})`;
    }
    const btnTabStaff = document.getElementById('btnTabAdminPersonal');
    if (btnTabStaff) {
      btnTabStaff.style.display = (currentUser.rol === 'admin') ? 'inline-block' : 'none';
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
      selectStudent(students[0].id);
    }
  }
}

function switchDevTab(tab) {
  document.querySelectorAll('.dev-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.dev-tab-content').forEach(c => c.style.display = 'none');

  if (tab === 'usuarios') {
    const btn = document.getElementById('btnDevTabUsuarios');
    const content = document.getElementById('devTabContentUsuarios');
    if (btn) btn.classList.add('active');
    if (content) content.style.display = 'block';
    loadDevUsuarios();
  } else if (tab === 'disenos') {
    const btn = document.getElementById('btnDevTabDisenos');
    const content = document.getElementById('devTabContentDisenos');
    if (btn) btn.classList.add('active');
    if (content) content.style.display = 'block';
    loadDevDisenos();
  } else if (tab === 'diagnostico') {
    const btn = document.getElementById('btnDevTabDiagnostico');
    const content = document.getElementById('devTabContentDiagnostico');
    if (btn) btn.classList.add('active');
    if (content) content.style.display = 'block';
    loadDevStats();
  } else if (tab === 'escuelas') {
    const btn = document.getElementById('btnDevTabEscuelas');
    const content = document.getElementById('devTabContentEscuelas');
    if (btn) btn.classList.add('active');
    if (content) content.style.display = 'block';
    loadDevEscuelas();
  }
}

function switchDevToView(view) {
  const viewDev = document.getElementById('viewDeveloper');
  const viewAdmin = document.getElementById('viewAdmin');
  const appContainer = document.getElementById('appContainer');
  const bottomNav = document.getElementById('pwaBottomNav');

  if (view === 'admin') {
    if (viewDev) viewDev.style.display = 'none';
    if (viewAdmin) viewAdmin.style.display = 'block';
    const btnAdminDev = document.getElementById('btnAdminDevPanel');
    if (btnAdminDev) btnAdminDev.style.display = 'inline-flex';
    loadAdminData();
    setupAdminSmartSearch();
  } else if (view === 'student') {
    if (viewDev) viewDev.style.display = 'none';
    if (appContainer) appContainer.style.display = 'block';
    if (bottomNav) bottomNav.style.display = 'flex';
    if (students && students.length > 0) {
      selectStudent(students[0].id);
    }
  } else if (view === 'pos') {
    window.open('/pos.html', '_blank');
  }
}

function switchAdminToDev() {
  const viewAdmin = document.getElementById('viewAdmin');
  const viewDev = document.getElementById('viewDeveloper');
  if (viewAdmin) viewAdmin.style.display = 'none';
  if (viewDev) viewDev.style.display = 'block';
}

function logout(skipConfirm = false) {
  if (skipConfirm || confirm('¿Deseas cerrar sesión para seleccionar otra cuenta?')) {
    localStorage.removeItem('sibopay_user');
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

    // 3. Cargar catálogo de diseños de tarjetas
    await loadCardDesigns();
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
  const walletAvatar = document.getElementById('walletAvatar');
  if (walletAvatar) {
    if (walletAvatar.tagName === 'IMG') {
      walletAvatar.src = currentStudent.foto_url || '/img/avatar_default.png';
    } else {
      walletAvatar.textContent = getStudentInitials(currentStudent.nombre_completo);
    }
  }
  document.getElementById('walletName').textContent = currentStudent.nombre_completo;
  document.getElementById('walletGrade').textContent = `${currentStudent.grado} • Sección ${currentStudent.seccion} • Cód: ${currentStudent.codigo_estudiante}`;
  
  // Aplicar tema personalizado de tarjeta
  if (typeof applyCardTheme === 'function' && typeof getSavedCardTheme === 'function') {
    applyCardTheme(getSavedCardTheme());
  }

  // Saldo en colones
  document.getElementById('walletBalance').textContent = `₡${currentStudent.saldo_colones.toLocaleString('es-CR')}`;
  document.getElementById('balanceLabel').textContent = 'SALDO DISPONIBLE';
  const coin = document.getElementById('kidsCoinIcon');
  if (coin) coin.style.display = 'none';
  const qrBtn = document.getElementById('qrBtnText');
  if (qrBtn) qrBtn.textContent = 'Mi QR';
  const transferBtn = document.getElementById('transferBtnText');
  if (transferBtn) transferBtn.textContent = 'Transferir';

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

  // Gray-out del botón Transferir cuando los padres lo desactivan
  const btnCardTransfer = document.getElementById('btnCardTransfer');
  const pwaNavTransfer = document.getElementById('pwaNavTransfer');
  const transferenciasHabilitadas = currentStudent.permitir_transferencias !== 0;

  if (btnCardTransfer) {
    if (!transferenciasHabilitadas) {
      btnCardTransfer.classList.add('transfer-btn-disabled');
    } else {
      btnCardTransfer.classList.remove('transfer-btn-disabled');
    }
  }
  if (pwaNavTransfer) {
    if (!transferenciasHabilitadas) {
      pwaNavTransfer.classList.add('transfer-nav-disabled');
    } else {
      pwaNavTransfer.classList.remove('transfer-nav-disabled');
    }
  }

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
  const svgSun = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
  const svgMoon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
  if (saved === 'dark') {
    document.body.classList.add('dark-mode');
    if (btn) btn.innerHTML = svgSun;
  } else {
    document.body.classList.remove('dark-mode');
    if (btn) btn.innerHTML = svgMoon;
  }
}

function toggleTheme() {
  const isDark = document.body.classList.toggle('dark-mode');
  const btn = document.getElementById('btnThemeToggle');
  const svgSun = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
  const svgMoon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
  if (isDark) {
    if (btn) btn.innerHTML = svgSun;
    localStorage.setItem('recreopay_theme', 'dark');
  } else {
    if (btn) btn.innerHTML = svgMoon;
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
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin-right:4px;"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg> Todos
    </button>
  `;

  for (const cat of categories) {
    html += `
      <button class="cat-pill ${activeCategoryId === cat.id ? 'active' : ''}" onclick="selectCategory(${cat.id})">
        <span>${cat.icono || '🍽️'}</span> ${cat.nombre}
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
        <div style="display: flex; justify-content: center; margin-bottom: 8px;"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity: 0.4;"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg></div>
        <p>No hay productos en esta categoría por ahora.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map(prod => {
    const isOutOfStock = prod.disponible === 0 || (prod.control_stock === 1 && prod.stock <= 0);
    const stockBadge = isOutOfStock
      ? '<span class="badge-out-of-stock">AGOTADO</span>'
      : '';

    return `
      <div class="product-card ${isOutOfStock ? 'out-of-stock' : ''}">
        <div class="product-icon-wrap">${prod.icono || '🥪'}</div>
        <div>
          <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 4px;">
            ${prod.cumple_mep ? '<span class="badge-mep">MEP Saludable</span>' : ''}
            ${stockBadge}
          </div>
          <h4 class="product-name">${prod.nombre}</h4>
          <p class="product-desc">${prod.descripcion || ''}</p>
          ${prod.alergenos ? `<div style="font-size: 0.68rem; color: #dc2626; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Contiene: ${prod.alergenos}</div>` : ''}
        </div>
        <div class="product-footer">
          <span class="product-price">₡${prod.precio_colones.toLocaleString('es-CR')}</span>
          ${isOutOfStock ? `
            <button class="add-btn" disabled style="opacity: 0.5; background: #94a3b8; cursor: not-allowed;" title="Producto Agotado">
              ✕
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

  if (prod.disponible === 0 || (prod.control_stock === 1 && prod.stock <= 0)) {
    alert(`El producto "${prod.nombre}" se encuentra agotado o no disponible en la soda.`);
    return;
  }

  const existing = cart.find(item => item.product.id === productId);
  const currentInCart = existing ? existing.cantidad : 0;
  if (prod.control_stock === 1 && (currentInCart + 1) > prod.stock) {
    alert(`Solo quedan ${prod.stock} unidad(es) de "${prod.nombre}" en inventario.`);
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
          <strong style="font-size: 0.9rem; color: #0f172a;">${item.product.icono ? `${item.product.icono} ` : ''}${item.product.nombre}</strong>
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

    alert(`¡Pre-Orden confirmada con éxito!\nCódigo de entrega: ${data.codigo_orden}\nRebajada de tu monedero: ₡${data.total_colones.toLocaleString('es-CR')}\n\nPodrás retirarla en la fila rápida de la soda durante el recreo presentando tu QR.`);

    // Limpiar carrito y recargar datos del estudiante
    cart = [];
    updateCartBar();
    closeCartModal();
    await selectStudent(currentStudent.id);
  } catch (err) {
    alert(`No se pudo procesar: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> <span>Confirmar y Pagar Pre-Orden</span>';
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
  if (!currentStudent) return;
  const inputMonto = document.getElementById('inputCustomSinpe');
  const inputComp = document.getElementById('inputCustomSinpeComprobante');
  const val = parseInt(inputMonto ? inputMonto.value : 0, 10);
  const comp = inputComp ? inputComp.value.trim() : '';

  if (!val || val <= 0) return alert('Por favor escribe un monto válido a recargar en colones.');
  if (!comp) return alert('Por favor escribe el número de comprobante SINPE.');

  try {
    const res = await fetch('/api/sinpe/solicitar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        estudiante_id: currentStudent.id,
        padre_usuario_id: currentUser && currentUser.rol === 'padre' ? currentUser.id : null,
        monto: val,
        comprobante: comp,
        notas: `Portal Parental Móvil para ${currentStudent.nombre_completo}`
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (window.sounds) window.sounds.playSuccess();
    alert(`¡Solicitud de Recarga Enviada!\n\nMonto: ₡${val.toLocaleString('es-CR')}\nComprobante: #${comp}\n\nLa soda verificará el depósito y el saldo se acreditará automáticamente.`);

    if (inputMonto) inputMonto.value = '';
    if (inputComp) inputComp.value = '';
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    alert(`Error al enviar solicitud SINPE: ${err.message}`);
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
        fb.textContent = `Límite fijado en ₡${val.toLocaleString('es-CR')} con éxito`;
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
    return alert('Tus padres tienen desactivadas las transferencias entre compañeros en tu perfil.');
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
    <button type="button" onclick="selectTransferTargetById(${s.id})" style="display: flex; align-items: center; gap: 6px; padding: 4px 8px; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.72rem; font-weight: 700; cursor: pointer; color: #1e293b;">
      <span style="width: 22px; height: 22px; border-radius: 50%; background: #0284c7; color: white; display: inline-flex; align-items: center; justify-content: center; font-size: 0.65rem; font-weight: 900;">${getStudentInitials(s.nombre_completo)}</span>
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

  const targetAvatar = document.getElementById('transferTargetAvatar');
  if (targetAvatar) {
    if (targetAvatar.tagName === 'IMG') {
      targetAvatar.src = target.foto_url || '/img/avatar_default.png';
    } else {
      targetAvatar.textContent = getStudentInitials(target.nombre_completo);
    }
  }
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

  document.getElementById('transferStepScan').style.display = 'none';
  document.getElementById('transferStepConfirm').style.display = 'block';

  // Enfocar automáticamente el PIN para desplegar el teclado nativo del teléfono
  setTimeout(() => {
    const pin = document.getElementById('inputTransferPin');
    if (pin) {
      pin.focus();
      try { pin.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(e){}
    }
  }, 200);
}

function resetTransferScan() {
  selectedTransferTarget = null;
  document.getElementById('transferStepConfirm').style.display = 'none';
  document.getElementById('transferStepScan').style.display = 'block';
  startTransferCamera();
}

function setTransferAmount(val, btn) {
  currentTransferAmount = val;
  document.querySelectorAll('#transferStepConfirm .transfer-amount-btn, #transferStepConfirm .mode-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const customInput = document.getElementById('inputTransferCustomAmount');
  if (customInput) customInput.value = val;
  updateTransferConfirmButton(val);
  if (window.sounds) window.sounds.playCoin();
}

function updateTransferConfirmButton(monto) {
  const lbl = document.getElementById('lblBtnConfirmTransferText');
  if (lbl) {
    lbl.textContent = `Enviar ₡${(monto || 0).toLocaleString('es-CR')} al Instante`;
  }
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
    pinInput.type = 'tel';
    if (btn) btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>';
  } else {
    pinInput.type = 'password';
    if (btn) btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
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
    if (status) status.textContent = 'Requiere HTTPS';
    if (helpOverlay) {
      helpOverlay.style.display = 'flex';
      if (helpText) {
        helpText.innerHTML = `
          <div style="font-weight: 800; color: #fca5a5; font-size: 0.85rem; margin-bottom: 4px;">Cámara requiere HTTPS</div>
          <span style="font-size: 0.72rem; color: #cbd5e1;">Por seguridad, los navegadores en celulares bloquean la cámara si la conexión no es HTTPS. Toca el botón para abrir la app segura:</span>
        `;
      }
      if (actionContainer) {
        actionContainer.innerHTML = `
          <button type="button" onclick="window.location.href='${CLOUDFLARE_TUNNEL_URL}' + window.location.pathname" style="padding: 10px 16px; background: #10b981; color: white; border: none; border-radius: 10px; font-weight: 900; font-size: 0.84rem; cursor: pointer; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4); display: inline-flex; align-items: center; gap: 6px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Cambiar a HTTPS Seguro
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

    if (status) status.innerHTML = '<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#22c55e; margin-right:6px;"></span> Escaneando QR...';
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
      userMsg = 'Permiso denegado: El navegador bloqueó la cámara. Habilita el acceso en los ajustes de tu navegador.';
    } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
      userMsg = 'No se detectó ninguna cámara física en este dispositivo.';
    } else if (errName === 'NotReadableError' || errName === 'TrackStartError') {
      userMsg = 'La cámara está ocupada por otra app. Ciérrala e intenta de nuevo.';
    } else if (errName === 'OverconstrainedError') {
      userMsg = 'Tu cámara no admite la resolución solicitada.';
    }

    if (status) status.textContent = 'Cámara bloqueada o no disponible';
    if (helpOverlay) {
      helpOverlay.style.display = 'flex';
      if (helpText) {
        helpText.innerHTML = `
          <div style="font-weight: 800; color: #fca5a5; font-size: 0.8rem; margin-bottom: 4px;">Permiso Requerido</div>
          <span style="font-size: 0.72rem; color: #f1f5f9;">${userMsg}</span>
        `;
      }
      if (actionContainer) {
        actionContainer.innerHTML = `
          <button type="button" onclick="startTransferCamera(true)" style="padding: 8px 16px; background: #0284c7; color: white; border: none; border-radius: 8px; font-weight: 800; font-size: 0.82rem; cursor: pointer; box-shadow: 0 4px 10px rgba(2, 132, 199, 0.4); display: inline-flex; align-items: center; gap: 6px;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg> Permitir Cámara
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
      if (status) status.textContent = 'No se detectó QR';
      alert('No se detectó ningún código QR en la foto. Intenta tomarla más de cerca con buena iluminación.');
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
        alert('Este es tu propio código QR. Escanea el carné o QR de tu compañero.');
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
    return alert('Por favor ingresa tu PIN de seguridad.');
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

    alert(`¡TRANSFERENCIA EXITOSA!\nLe pasaste ₡${data.monto.toLocaleString('es-CR')} a ${data.receptor.nombre}.\nTu nuevo saldo es ₡${data.emisor.saldo_nuevo.toLocaleString('es-CR')}.`);

    closeTransferModal();
    await selectStudent(currentStudent.id);
  } catch (err) {
    alert(`Fallo en la transferencia: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> <span>Enviar Dinero al Instante</span>';
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
    updateStudentUI();
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

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function subscribeDeviceToWebPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return null;
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();

    if (!sub) {
      const resKey = await fetch('/api/push/vapid-public-key');
      const dataKey = await resKey.json();
      if (!dataKey || !dataKey.publicKey) return null;

      const convertedKey = urlBase64ToUint8Array(dataKey.publicKey);
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedKey
      });
    }

    let user = currentUser;
    if (!user) {
      try {
        const stored = localStorage.getItem('recreopay_user');
        if (stored) user = JSON.parse(stored);
      } catch (e) {}
    }

    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: sub,
        userId: user ? user.id : null,
        rol: user ? user.rol : 'admin',
        escuelaId: user ? user.escuela_id : 1
      })
    });

    return sub;
  } catch (err) {
    console.warn('[WebPush] Error suscribiendo dispositivo:', err);
    return null;
  }
}

function sendPushNotification(title, options = {}) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const defaultOptions = {
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [200, 100, 200, 100, 200],
    requireInteraction: true,
    ...options
  };

  if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
    navigator.serviceWorker.ready.then(reg => {
      reg.showNotification(title, defaultOptions);
    }).catch(() => {
      try { new Notification(title, defaultOptions); } catch (e) {}
    });
  } else {
    try { new Notification(title, defaultOptions); } catch (e) {}
  }
}

function showInAppNotification({ title, message, buttonText = 'Ver en Terminal', url = '/pos.html?tab=sinpe' }) {
  const existing = document.getElementById('recreoPayInAppToast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'recreoPayInAppToast';
  toast.className = 'recreopay-inapp-toast';
  toast.innerHTML = `
    <div class="recreopay-inapp-toast-icon">📱</div>
    <div class="recreopay-inapp-toast-content">
      <div class="recreopay-inapp-toast-title">
        <span>${title}</span>
      </div>
      <div class="recreopay-inapp-toast-body">${message}</div>
    </div>
    <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
      <button class="recreopay-inapp-toast-btn" id="btnInAppToastAction">${buttonText}</button>
      <button class="recreopay-inapp-toast-close" onclick="dismissInAppToast()">✕</button>
    </div>
  `;

  document.body.appendChild(toast);

  document.getElementById('btnInAppToastAction').onclick = () => {
    dismissInAppToast();
    if (url) {
      window.location.href = url;
    }
  };

  if ('vibrate' in navigator) {
    try { navigator.vibrate([200, 100, 200]); } catch (e) {}
  }

  if (window.sounds && window.sounds.playCoin) {
    try { window.sounds.playCoin(); } catch (e) {}
  }

  clearTimeout(window._inAppToastTimer);
  window._inAppToastTimer = setTimeout(dismissInAppToast, 14000);
}

function dismissInAppToast() {
  const toast = document.getElementById('recreoPayInAppToast');
  if (!toast) return;
  toast.classList.add('closing');
  setTimeout(() => toast.remove(), 250);
}

// SSE en tiempo real para eventos de la soda y monederos
let sseSource = null;
let sseReconnectTimer = null;

function initStudentSSE() {
  if (sseSource) {
    try { sseSource.close(); } catch (e) {}
  }

  sseSource = new EventSource('/api/events');
  const sse = sseSource;

  sse.onerror = () => {
    try { sse.close(); } catch(e) {}
    if (!sseReconnectTimer) {
      sseReconnectTimer = setTimeout(() => {
        sseReconnectTimer = null;
        initStudentSSE();
      }, 3000);
    }
  };

  // Cobro inmediato en caja / pre-orden realizada
  sse.addEventListener('nueva_orden', (e) => {
    try {
      const data = JSON.parse(e.data);
      const estId = Number(data.estudiante_id || (data.financiero && data.financiero.estudiante && data.financiero.estudiante.id));
      const myId = currentStudent ? Number(currentStudent.id) : (currentUser && currentUser.estudiante ? Number(currentUser.estudiante.id) : null);

      // Si el estudiante en pantalla fue a quien se le cobró
      if (myId && myId === estId) {
        if (window.sounds) window.sounds.playCoin();

        if (data.financiero && data.financiero.estudiante) {
          const f = data.financiero.estudiante;
          if (currentStudent) {
            currentStudent.saldo_colones = f.saldo_nuevo;
            currentStudent.gastado_hoy = f.gastado_hoy;
            currentStudent.disponible_hoy = (typeof f.disponible_hoy === 'number')
              ? f.disponible_hoy
              : Math.max(0, (f.limite_diario || currentStudent.limite_diario_colones || 0) - (f.gastado_hoy || 0));
          }
          if (currentUser && currentUser.estudiante) {
            currentUser.estudiante.saldo_colones = f.saldo_nuevo;
          }
          updateStudentUI();
          triggerBalancePulse();
        }
        fetch(`/api/estudiantes/${estId}`).then(r => r.json()).then(s => { if (s && currentStudent && currentStudent.id === s.id) { currentStudent = s; updateStudentUI(); } }).catch(()=>{});
      }

      // Si es padre de este estudiante
      if (currentUser && currentUser.rol === 'padre') {
        loadParentDashboard();
      }

      // Si es admin
      if (currentUser && (currentUser.rol === 'admin' || currentUser.rol === 'cajero')) {
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
      const estId = Number(data.estudiante_id || data.id);
      const myId = currentStudent ? Number(currentStudent.id) : (currentUser && currentUser.estudiante ? Number(currentUser.estudiante.id) : null);

      if (myId && myId === estId) {
        if (window.sounds) window.sounds.playCoin();
        if (currentStudent) {
          if (typeof data.saldo_colones === 'number') currentStudent.saldo_colones = data.saldo_colones;
          if (typeof data.saldo_nuevo === 'number') currentStudent.saldo_colones = data.saldo_nuevo;
          if (typeof data.disponible_hoy === 'number') currentStudent.disponible_hoy = data.disponible_hoy;
          if (typeof data.gastado_hoy === 'number') currentStudent.gastado_hoy = data.gastado_hoy;
        }
        if (currentUser && currentUser.estudiante) {
          if (typeof data.saldo_colones === 'number') currentUser.estudiante.saldo_colones = data.saldo_colones;
          if (typeof data.saldo_nuevo === 'number') currentUser.estudiante.saldo_colones = data.saldo_nuevo;
        }
        updateStudentUI();
        triggerBalancePulse();
        fetch(`/api/estudiantes/${estId}`).then(r => r.json()).then(s => { if (s && currentStudent && currentStudent.id === s.id) { currentStudent = s; updateStudentUI(); } }).catch(()=>{});
      }

      if (currentUser && currentUser.rol === 'padre') {
        loadParentDashboard();
      }
      if (currentUser && (currentUser.rol === 'admin' || currentUser.rol === 'cajero')) {
        loadAdminData();
      }
    } catch (err) {}
  });

  sse.addEventListener('solicitud_sinpe_procesada', (e) => {
    try {
      if (currentUser && currentUser.rol === 'padre') {
        if (currentParentChild) {
          loadParentSinpeRequests(currentParentChild.id);
        }
        loadParentDashboard();
      }
    } catch (err) {}
  });

  sse.addEventListener('transferencia_realizada', (e) => {
    try {
      const data = JSON.parse(e.data);
      const myId = currentStudent ? Number(currentStudent.id) : (currentUser && currentUser.estudiante ? Number(currentUser.estudiante.id) : null);
      if (myId && data.receptor && Number(data.receptor.id) === myId) {
        if (window.sounds) window.sounds.playCoin();
        if (currentStudent && typeof data.receptor.saldo_nuevo === 'number') {
          currentStudent.saldo_colones = data.receptor.saldo_nuevo;
          updateStudentUI();
          triggerBalancePulse();
        }
        alert(`¡Transferencia Recibida!\n${data.emisor.nombre} te transfirió ₡${data.monto.toLocaleString('es-CR')}.\nMotivo: ${data.motivo}`);
        fetch(`/api/estudiantes/${myId}`).then(r => r.json()).then(s => { if (s && currentStudent && currentStudent.id === s.id) { currentStudent = s; updateStudentUI(); } }).catch(()=>{});
      } else if (myId && data.emisor && Number(data.emisor.id) === myId) {
        if (currentStudent && typeof data.emisor.saldo_nuevo === 'number') {
          currentStudent.saldo_colones = data.emisor.saldo_nuevo;
          updateStudentUI();
          triggerBalancePulse();
        }
        fetch(`/api/estudiantes/${myId}`).then(r => r.json()).then(s => { if (s && currentStudent && currentStudent.id === s.id) { currentStudent = s; updateStudentUI(); } }).catch(()=>{});
      }

      if (currentUser && currentUser.rol === 'padre') {
        loadParentDashboard();
      }
    } catch (err) {}
  });

  // RECARGA DE SALDO INMEDIATA (0ms de latencia visual)
  sse.addEventListener('recarga_exitosa', (e) => {
    try {
      const data = JSON.parse(e.data);
      const estId = Number(data.estudiante_id || data.id);
      const myId = currentStudent ? Number(currentStudent.id) : (currentUser && currentUser.estudiante ? Number(currentUser.estudiante.id) : null);

      if (myId && myId === estId) {
        if (window.sounds) window.sounds.playCoin();
        const nuevo = typeof data.saldo_nuevo === 'number' ? data.saldo_nuevo : data.saldo_colones;
        if (typeof nuevo === 'number') {
          if (currentStudent) currentStudent.saldo_colones = nuevo;
          if (currentUser && currentUser.estudiante) currentUser.estudiante.saldo_colones = nuevo;
          updateStudentUI();
          triggerBalancePulse();
        }
        fetch(`/api/estudiantes/${estId}`).then(r => r.json()).then(s => { if (s && currentStudent && currentStudent.id === s.id) { currentStudent = s; updateStudentUI(); } }).catch(()=>{});
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

  // NUEVA SOLICITUD DE RECARGA SINPE (NOTIFICACIÓN ADMIN & PUSH)
  sse.addEventListener('solicitud_sinpe_nueva', (e) => {
    try {
      const sol = JSON.parse(e.data);
      const isAdminOrStaff = currentUser && ['admin', 'cajero', 'personal', 'dev', 'soda'].includes(currentUser.rol);

      if (isAdminOrStaff) {
        const montoFmt = (sol.monto_colones || 0).toLocaleString('es-CR');
        const estNombre = sol.estudiante_nombre || 'Estudiante';
        const comp = sol.comprobante_sinpe || '';

        // 1. Notificación flotante en la aplicación
        showInAppNotification({
          title: '¡Nueva Recarga SINPE Reportada!',
          message: `<strong>${estNombre}</strong>: ₡${montoFmt} • Comp #${comp}`,
          url: '/pos.html?tab=sinpe',
          buttonText: 'Ver en Terminal POS'
        });

        // 2. Notificación PUSH del navegador / sistema
        sendPushNotification('🔔 Nueva Recarga SINPE - RecreoPay', {
          body: `Se reportó una recarga de ₡${montoFmt} para ${estNombre}. Comprobante: #${comp}`,
          tag: `sinpe-${sol.id || Date.now()}`,
          data: { url: '/pos.html?tab=sinpe' }
        });
      }

      if (currentUser && currentUser.rol === 'padre') {
        loadParentDashboard();
      }
    } catch (err) {
      console.warn('Error en SSE solicitud_sinpe_nueva:', err);
    }
  });

  sse.addEventListener('producto_actualizado', (e) => {
    try {
      const prod = JSON.parse(e.data);
      // Actualizar en el catálogo de estudiantes
      const idx = products.findIndex(p => p.id === prod.id);
      if (idx !== -1) {
        if (prod.eliminado) {
          products.splice(idx, 1);
        } else {
          products[idx] = { ...products[idx], ...prod };
        }
        renderProducts();
      } else if (!prod.eliminado) {
        products.push(prod);
        renderProducts();
      }
      // Actualizar en admin
      if (currentUser && (currentUser.rol === 'admin' || currentUser.rol === 'cajero')) {
        const adminIdx = adminProducts.findIndex(p => p.id === prod.id);
        if (adminIdx !== -1) {
          if (prod.eliminado) {
            adminProducts.splice(adminIdx, 1);
          } else {
            adminProducts[adminIdx] = { ...adminProducts[adminIdx], ...prod };
          }
          filterAdminProducts(adminSearchQuery);
        } else if (!prod.eliminado) {
          adminProducts.unshift(prod);
          filterAdminProducts(adminSearchQuery);
        }
      }
    } catch (err) {}
  });

  sse.addEventListener('estudiante_actualizado', (e) => {
    try {
      const data = JSON.parse(e.data);
      const estId = Number(data.id || data.estudiante_id);
      const myId = currentStudent ? Number(currentStudent.id) : (currentUser && currentUser.estudiante ? Number(currentUser.estudiante.id) : null);
      if (myId && myId === estId) {
        if (currentStudent) {
          if (typeof data.saldo_colones === 'number') currentStudent.saldo_colones = data.saldo_colones;
          if (typeof data.saldo_nuevo === 'number') currentStudent.saldo_colones = data.saldo_nuevo;
          if (typeof data.disponible_hoy === 'number') currentStudent.disponible_hoy = data.disponible_hoy;
          if (typeof data.gastado_hoy === 'number') currentStudent.gastado_hoy = data.gastado_hoy;
          if (typeof data.limite_diario_colones === 'number') currentStudent.limite_diario_colones = data.limite_diario_colones;
        }
        if (currentUser && currentUser.estudiante) {
          if (typeof data.saldo_colones === 'number') currentUser.estudiante.saldo_colones = data.saldo_colones;
          if (typeof data.saldo_nuevo === 'number') currentUser.estudiante.saldo_colones = data.saldo_nuevo;
        }
        updateStudentUI();
        triggerBalancePulse();
        fetch(`/api/estudiantes/${estId}`).then(r => r.json()).then(s => { if (s && currentStudent && currentStudent.id === s.id) { currentStudent = s; updateStudentUI(); } }).catch(()=>{});
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

  sse.addEventListener('disenos_actualizados', async () => {
    try {
      await loadCardDesigns();
      const modal = document.getElementById('modalCardDesigns');
      if (modal && modal.style.display !== 'none') {
        renderCardDesignsCarousel();
      }
      if (typeof loadDevDisenos === 'function' && currentUser && currentUser.rol === 'developer') {
        loadDevDisenos();
      }
    } catch (err) {}
  });
}

// Sincronización en segundo plano: al volver a la pestaña/desbloquear el teléfono
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (currentStudent && currentStudent.id) {
      fetch(`/api/estudiantes/${currentStudent.id}`)
        .then(r => r.json())
        .then(fresh => {
          if (fresh && currentStudent && currentStudent.id === fresh.id) {
            const cambio = currentStudent.saldo_colones !== fresh.saldo_colones;
            currentStudent = fresh;
            updateStudentUI();
            if (cambio) {
              triggerBalancePulse();
              if (window.sounds) window.sounds.playCoin();
            }
          }
        })
        .catch(() => {});
    }
    if (currentUser && currentUser.rol === 'padre') {
      loadParentDashboard();
    }
    if (!sseSource || sseSource.readyState === EventSource.CLOSED) {
      initStudentSSE();
    }
  }
});

// Comprobación rápida periódica (cada 4s) cuando la app de estudiante está visible
setInterval(async () => {
  if (document.visibilityState === 'visible' && currentStudent && currentStudent.id && currentUser && currentUser.rol === 'estudiante') {
    try {
      const res = await fetch(`/api/estudiantes/${currentStudent.id}`);
      if (res.ok) {
        const fresh = await res.json();
        if (fresh && currentStudent && currentStudent.id === fresh.id && fresh.saldo_colones !== currentStudent.saldo_colones) {
          currentStudent = fresh;
          updateStudentUI();
          triggerBalancePulse();
          if (window.sounds) window.sounds.playCoin();
        }
      }
    } catch (e) {}
  }
}, 4000);

// ==========================================
// FUNCIONES DEL PORTAL DEDICADO DE PADRES
// ==========================================

// Helper para obtener iniciales del primer nombre y primer apellido (ej. Mateo Alvarado -> MA, Sofía Jiménez -> SJ)
function getStudentInitials(fullName) {
  if (!fullName || typeof fullName !== 'string') return 'ES';
  const clean = fullName.trim().replace(/\s+/g, ' ');
  const parts = clean.split(' ');
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
}

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
  const mainDash = document.getElementById('parentChildDashboardMain');

  const hijos = (currentUser && currentUser.hijos) ? currentUser.hijos : [];

  if (hijos.length === 0) {
    if (bannerNoHijos) bannerNoHijos.style.display = 'block';
    if (sectionHijos) sectionHijos.style.display = 'none';
    if (containerActive) containerActive.style.display = 'none';
    if (grid) grid.innerHTML = '';
    return;
  }

  if (bannerNoHijos) bannerNoHijos.style.display = 'none';
  if (sectionHijos) sectionHijos.style.display = 'block';
  if (containerActive) containerActive.style.display = 'block';
  if (mainDash) mainDash.style.display = 'block';

  // Si no hay hijo seleccionado o el seleccionado ya no existe en la lista, seleccionar el primero
  if (!currentParentChild || !hijos.some(h => h.id === currentParentChild.id)) {
    currentParentChild = hijos[0];
  } else {
    // Actualizar datos del hijo seleccionado desde la lista actualizada
    currentParentChild = hijos.find(h => h.id === currentParentChild.id) || hijos[0];
  }

  // Renderizar tarjetas de hijos en la cuadrícula con monograma de iniciales y borde celeste activo
  if (grid) {
    grid.innerHTML = hijos.map(h => {
      const isSelected = currentParentChild && currentParentChild.id === h.id;
      const isBlocked = !!h.tarjeta_bloqueada;
      const initials = getStudentInitials(h.nombre_completo);
      return `
        <div class="parent-child-card ${isSelected ? 'active selected' : ''}" onclick="selectParentChild(${h.id})">
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
            <div class="child-initials-badge ${isSelected ? 'active' : ''}">
              ${initials}
            </div>
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
    closeParentSubView();
    renderParentDashboardView();
    if (window.sounds) window.sounds.playTap();
  }
}

function openParentSubView(viewKey) {
  const mainDash = document.getElementById('parentChildDashboardMain');
  const childrenSection = document.getElementById('parentChildrenSection');
  if (mainDash) mainDash.style.display = 'none';
  if (childrenSection) childrenSection.style.display = 'none';

  const subViews = [
    'parentSubViewSinpe',
    'parentSubViewAlergias',
    'parentSubViewLimites',
    'parentSubViewHistorial',
    'parentSubViewCredenciales'
  ];
  subViews.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  if (currentParentChild) {
    const initials = getStudentInitials(currentParentChild.nombre_completo);
    document.querySelectorAll('.parentSubViewChildAvatarBadge').forEach(badge => {
      badge.textContent = initials;
    });
    document.querySelectorAll('.parentSubViewChildName').forEach(span => {
      span.textContent = `${currentParentChild.nombre_completo} (${currentParentChild.grado})`;
    });
  }

  let targetId = '';
  if (viewKey === 'sinpe') targetId = 'parentSubViewSinpe';
  else if (viewKey === 'alergias') targetId = 'parentSubViewAlergias';
  else if (viewKey === 'limites') targetId = 'parentSubViewLimites';
  else if (viewKey === 'historial') targetId = 'parentSubViewHistorial';
  else if (viewKey === 'credenciales') targetId = 'parentSubViewCredenciales';

  const targetEl = document.getElementById(targetId);
  if (targetEl) {
    targetEl.style.display = 'block';
  }

  if (viewKey === 'sinpe' && currentParentChild) {
    loadParentSinpeRequests(currentParentChild.id);
  } else if (viewKey === 'historial' && currentParentChild) {
    loadActiveChildHistory(currentParentChild.id);
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (window.sounds) window.sounds.playTap();
}

function closeParentSubView() {
  const mainDash = document.getElementById('parentChildDashboardMain');
  const childrenSection = document.getElementById('parentChildrenSection');
  if (mainDash) mainDash.style.display = 'block';
  if (childrenSection) childrenSection.style.display = 'block';

  const subViews = [
    'parentSubViewSinpe',
    'parentSubViewAlergias',
    'parentSubViewLimites',
    'parentSubViewHistorial',
    'parentSubViewCredenciales'
  ];
  subViews.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (window.sounds) window.sounds.playTap();
}

function focusParentSinpeRecharge() {
  openParentSubView('sinpe');
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

  if (avatar) {
    if (avatar.tagName === 'IMG') {
      avatar.src = child.foto_url || '/img/avatar_default.png';
    } else {
      avatar.textContent = getStudentInitials(child.nombre_completo);
    }
  }
  if (name) name.textContent = child.nombre_completo;
  if (meta) meta.textContent = `${child.grado} - Sección ${child.seccion} • Cód: ${child.codigo_estudiante}`;
  if (balance) balance.textContent = `₡${(child.saldo_colones || 0).toLocaleString('es-CR')}`;

  const currentLimit = child.limite_diario_colones || 3000;
  if (lblLimit) lblLimit.textContent = `₡${currentLimit.toLocaleString('es-CR')}`;
  if (inputCustomLimit) inputCustomLimit.value = currentLimit;
  if (rangeLimit) rangeLimit.value = currentLimit;
  if (chkTransfer) chkTransfer.checked = child.permitir_transferencias !== 0;

  // Actualizar Límite Diario en tarjeta de saldo y nombre de sede activa
  const dailyInline = document.getElementById('parentDailyLimitInlineDisplay');
  if (dailyInline) dailyInline.textContent = `₡${currentLimit.toLocaleString('es-CR')}`;
  const schoolBadge = document.getElementById('parentActiveSchoolNameBadge');
  if (schoolBadge) schoolBadge.textContent = child.escuela_nombre || 'Soda Escolar Central';

  // Actualizar Alergias y Restricciones
  const inputAllergies = document.getElementById('inputParentStudentAllergies');
  const chkJunkFood = document.getElementById('chkParentBlockJunkFood');
  const allergiesBadge = document.getElementById('parentAllergiesStatusBadge');
  const hasAlergias = child.alergias && child.alergias !== 'Ninguna' && child.alergias !== 'Ninguna conocida';

  if (inputAllergies) inputAllergies.value = hasAlergias ? child.alergias : '';
  if (chkJunkFood) chkJunkFood.checked = !!child.bloquear_chucherias;
  if (allergiesBadge) {
    if (hasAlergias || child.bloquear_chucherias) {
      allergiesBadge.textContent = hasAlergias ? 'Alergias Activas' : 'Veto de Chatarra';
      allergiesBadge.style.background = '#ffe4e6';
      allergiesBadge.style.color = '#e11d48';
    } else {
      allergiesBadge.textContent = 'Sin alergias';
      allergiesBadge.style.background = '#f1f5f9';
      allergiesBadge.style.color = '#64748b';
    }
  }

  // Actualizar datos de la soda/escuela del hijo seleccionado para recargas SINPE
  const sinpeNumero = document.getElementById('parentSinpeNumero');
  const sinpeEscuela = document.getElementById('parentSinpeEscuelaNombre');
  const sinpeTitular = document.getElementById('parentSinpeTitular');

  if (sinpeNumero) sinpeNumero.textContent = child.telefono_sinpe || '8888-8888';
  if (sinpeEscuela) sinpeEscuela.textContent = child.escuela_nombre || 'Soda Escolar';
  if (sinpeTitular) sinpeTitular.textContent = child.nombre_sinpe || child.escuela_nombre || 'Soda Central';

  loadActiveChildHistory(child.id);
  loadParentSinpeRequests(child.id);
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

async function executeParentSinpeRecharge() {
  if (!currentParentChild) {
    alert('Selecciona primero al estudiante a quien deseas recargarle.');
    return;
  }
  const inputMonto = document.getElementById('inputParentSinpeMonto');
  const inputComp = document.getElementById('inputParentSinpeComprobante');
  const btn = document.getElementById('btnParentValidarSinpe');

  const monto = parseInt(inputMonto ? inputMonto.value : 0, 10);
  const comprobante = inputComp ? inputComp.value.trim() : '';

  if (isNaN(monto) || monto <= 0) {
    alert('Ingresa un monto válido mayor a ₡0 para recargar.');
    if (inputMonto) inputMonto.focus();
    return;
  }
  if (!comprobante) {
    alert('Por favor ingresa el número de comprobante de la transferencia SINPE Móvil.');
    if (inputComp) inputComp.focus();
    return;
  }

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span>Verificando...</span>';
    }

    const res = await fetch('/api/sinpe/solicitar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        estudiante_id: currentParentChild.id,
        padre_usuario_id: currentUser ? currentUser.id : null,
        monto,
        comprobante,
        notas: `Portal de Padres - ${currentUser ? currentUser.nombre : 'Encargado'}`
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (window.sounds) window.sounds.playCoin();
    alert(`¡Solicitud de Recarga Enviada!\n\nMonto: ₡${monto.toLocaleString('es-CR')}\nComprobante: #${comprobante}\n\nLa soda verificará el depósito y el saldo se acreditará automáticamente.`);

    if (inputMonto) inputMonto.value = '';
    if (inputComp) inputComp.value = '';

    await loadParentSinpeRequests(currentParentChild.id);
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    alert(`Error al enviar solicitud SINPE: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><span>Validar SINPE</span>`;
    }
  }
}

async function loadParentSinpeRequests(studentId) {
  const box = document.getElementById('parentSinpePendingBox');
  const list = document.getElementById('parentSinpePendingList');
  if (!box || !list) return;

  try {
    const res = await fetch(`/api/sinpe/solicitudes/estudiante/${studentId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const solicitudes = data.solicitudes || [];
    if (solicitudes.length === 0) {
      box.style.display = 'none';
      list.innerHTML = '';
      return;
    }

    box.style.display = 'block';
    list.innerHTML = solicitudes.slice(0, 5).map(s => {
      const fecha = new Date(s.creado_en).toLocaleString('es-CR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      let badgeStyle = '';
      let badgeText = '';

      if (s.estado === 'pendiente') {
        badgeStyle = 'background: #fef3c7; color: #b45309; border: 1px solid #fde68a;';
        badgeText = '⏳ Por Verificar';
      } else if (s.estado === 'aprobada') {
        badgeStyle = 'background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0;';
        badgeText = '✅ Acreditado';
      } else {
        badgeStyle = 'background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca;';
        badgeText = '❌ Rechazado';
      }

      return `
        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 10px; display: flex; justify-content: space-between; align-items: center; font-size: 0.76rem;">
          <div>
            <div style="font-weight: 800; color: #0f172a;">₡${s.monto_colones.toLocaleString('es-CR')} <span style="font-weight: 500; color: #64748b;">(Comp: #${s.comprobante_sinpe})</span></div>
            <div style="font-size: 0.68rem; color: #94a3b8;">${fecha}</div>
          </div>
          <div>
            <span style="font-size: 0.7rem; font-weight: 800; padding: 3px 8px; border-radius: 6px; ${badgeStyle}">${badgeText}</span>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Error cargando solicitudes SINPE:', err);
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
    alert(`Límite diario actualizado a ₡${val.toLocaleString('es-CR')} para ${currentParentChild.nombre_completo}.`);
    await loadParentDashboard();
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    alert(`Error al guardar límite: ${err.message}`);
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
    if (currentStudent && currentStudent.id === currentParentChild.id) {
      currentStudent.permitir_transferencias = checked ? 1 : 0;
      updateStudentUI();
    }
    if (window.sounds) window.sounds.playTap();
  } catch (err) {
    alert(`No se pudo actualizar permiso de transferencia: ${err.message}`);
  }
}

function addParentAllergyTag(tag) {
  const input = document.getElementById('inputParentStudentAllergies');
  if (!input) return;
  let currentVal = input.value.trim();
  if (!currentVal) {
    input.value = tag;
  } else {
    const items = currentVal.split(',').map(s => s.trim().toLowerCase());
    if (!items.includes(tag.toLowerCase())) {
      input.value = currentVal + ', ' + tag;
    }
  }
  if (window.sounds) window.sounds.playTap();
}

function clearParentAllergies() {
  const input = document.getElementById('inputParentStudentAllergies');
  if (input) input.value = '';
  if (window.sounds) window.sounds.playTap();
}

async function onToggleParentBlockJunkFood(checked) {
  if (!currentParentChild) return;
  try {
    const res = await fetch(`/api/estudiantes/${currentParentChild.id}/limite`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bloquear_chucherias: checked ? 1 : 0 })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    currentParentChild.bloquear_chucherias = checked ? 1 : 0;
    if (window.sounds) window.sounds.playTap();
    renderActiveChildDetails(currentParentChild);
  } catch (err) {
    alert(`No se pudo actualizar restricción: ${err.message}`);
  }
}

async function saveParentAllergiesSettings() {
  if (!currentParentChild) return;
  const input = document.getElementById('inputParentStudentAllergies');
  const chkJunk = document.getElementById('chkParentBlockJunkFood');
  const alergiasText = input ? input.value.trim() : '';
  const bloquearJunk = chkJunk && chkJunk.checked ? 1 : 0;

  try {
    const res = await fetch(`/api/estudiantes/${currentParentChild.id}/limite`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alergias: alergiasText || 'Ninguna conocida',
        bloquear_chucherias: bloquearJunk
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    currentParentChild.alergias = alergiasText || 'Ninguna conocida';
    currentParentChild.bloquear_chucherias = bloquearJunk;

    if (window.sounds) window.sounds.playSuccess();
    alert(`Expediente médico de ${currentParentChild.nombre_completo} guardado exitosamente.`);
    renderActiveChildDetails(currentParentChild);
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    alert(`Error al guardar alergias: ${err.message}`);
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
    alert(`¡Credenciales de acceso escolar actualizadas!\n${data.mensaje}`);
    if (pinInput) pinInput.value = '';
    if (passInput) passInput.value = '';
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    alert(`Error al actualizar credenciales: ${err.message}`);
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
  closeParentSubView();
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
      badge.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px; margin-right: 4px;"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> Apunta al código QR del carné';
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
      badge.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px; margin-right: 4px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Cámara no disponible - Digita el código';
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
      errorMsg.textContent = 'Por favor ingresa el código del estudiante (ej: EST-2026-001).';
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
      btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> <span>Validar</span>';
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

    if (avatar) {
      if (avatar.tagName === 'IMG') {
        avatar.src = student.foto_url || '/img/avatar_default.png';
      } else {
        avatar.textContent = getStudentInitials(student.nombre_completo);
      }
    }
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
      errorMsg.textContent = `No se encontró ningún estudiante con el código "${tokenOrCode}". Verifica que el código esté bien escrito e intenta de nuevo.`;
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
    btnConfirm.innerHTML = '<span>Vinculando...</span>';
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
    alert(`¡Éxito!\n${data.mensaje}`);
    renderParentDashboardView();
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    alert(err.message);
  } finally {
    if (btnConfirm) {
      btnConfirm.disabled = false;
      btnConfirm.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> <span>Confirmar y Vincular</span>';
    }
  }
}

// ==========================================
// PANEL DE ADMINISTRACIÓN DE LA SODA
// ==========================================

function switchAdminTab(tabName) {
  const tabs = ['inventario', 'estudiantes', 'recarga', 'movimientos', 'personal'];
  tabs.forEach(t => {
    const btn = document.getElementById(`btnTabAdmin${t.charAt(0).toUpperCase() + t.slice(1)}`);
    const content = document.getElementById(`adminTabContent${t.charAt(0).toUpperCase() + t.slice(1)}`);
    if (btn) btn.classList.toggle('active', t === tabName);
    if (content) content.style.display = (t === tabName) ? 'block' : 'none';
  });

  if (tabName === 'movimientos') {
    loadAdminMovimientos();
  } else if (tabName === 'personal') {
    loadAdminStaff();
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

    // 4. Si las categorías están vacías, cargarlas para los modales
    if (!categories || categories.length === 0) {
      const resCat = await fetch('/api/productos');
      const dataCat = await resCat.json();
      if (dataCat && dataCat.categorias) {
        categories = dataCat.categorias;
      }
    }
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
      statusPill = `<span style="font-size: 0.7rem; font-weight: 800; color: #ef4444; background: #fee2e2; padding: 3px 8px; border-radius: 6px;">Agotado</span>`;
    } else if (isLowStock) {
      statusPill = `<span style="font-size: 0.7rem; font-weight: 800; color: #d97706; background: #fef3c7; padding: 3px 8px; border-radius: 6px;">Quedan ${p.stock}</span>`;
    } else {
      statusPill = `<span style="font-size: 0.7rem; font-weight: 800; color: #166534; background: #dcfce7; padding: 3px 8px; border-radius: 6px;">${p.stock} unid.</span>`;
    }

    return `
      <div class="inventory-item-row" style="${isOutOfStock ? 'background: #fff1f2;' : ''}">
        <div class="inventory-item-top" style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
          <div style="display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0;">
            <div style="font-size: 1.8rem; text-align: center; flex-shrink: 0; min-width: 40px;">${p.icono || '🥪'}</div>
            <div style="flex: 1; min-width: 0;">
              <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <strong style="font-size: 0.92rem; color: var(--text-main); word-break: break-word;">${p.nombre}</strong>
                ${statusPill}
                ${p.cumple_mep === 1 ? '<span style="font-size: 0.68rem; font-weight: 800; background: #dcfce7; color: #15803d; padding: 2px 6px; border-radius: 5px;">MEP Saludable</span>' : '<span style="font-size: 0.68rem; font-weight: 800; background: #fef3c7; color: #b45309; padding: 2px 6px; border-radius: 5px;">Ocasional</span>'}
              </div>
              <div style="font-size: 0.74rem; color: var(--text-muted); margin-top: 2px;">
                ${p.categoria_nombre || 'General'} • ₡${p.precio_colones.toLocaleString('es-CR')}
                ${p.descripcion ? ` • <span style="font-style: italic;">${p.descripcion}</span>` : ''}
              </div>
            </div>
          </div>
          <div style="flex-shrink: 0;">
            <button type="button" class="btn-saas btn-saas-outline" onclick="openEditProductModal(${p.id})" title="Editar este producto">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
              <span>Editar</span>
            </button>
          </div>
        </div>

        <!-- Controles rápidos de stock -->
        <div class="inventory-item-bottom">
          <div class="inventory-stock-controls" style="display: flex; align-items: center; gap: 4px;">
            <button type="button" class="btn-saas btn-saas-outline" style="height: 28px; padding: 0 8px; font-weight: 800;" onclick="quickAdjustStock(${p.id}, -1)" title="Restar 1">-1</button>
            <input type="number" id="inputStock_${p.id}" value="${p.stock || 0}" min="0" style="width: 52px; height: 28px; text-align: center; padding: 2px 4px; border-radius: 6px; border: 1px solid var(--border); font-weight: 800; font-size: 0.9rem; background: var(--card-bg); color: var(--text-main); outline: none;">
            <button type="button" class="btn-saas btn-saas-outline" style="height: 28px; padding: 0 8px; font-weight: 800;" onclick="quickAdjustStock(${p.id}, 5)" title="Sumar 5">+5</button>
            <button type="button" class="btn-saas btn-saas-outline" style="height: 28px; padding: 0 8px; font-weight: 800;" onclick="quickAdjustStock(${p.id}, 10)" title="Sumar 10">+10</button>
          </div>

          <div>
            <button type="button" onclick="saveProductStock(${p.id})" class="btn-saas btn-saas-primary" style="height: 28px; padding: 0 10px; font-size: 0.78rem;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              <span>Guardar</span>
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
    container.innerHTML = `<div style="text-align: center; padding: 32px 16px; color: var(--text-muted); font-size: 0.9rem;">No se encontraron estudiantes registrados.</div>`;
    return;
  }

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 8px;">
      ${list.map(s => {
        const isBlocked = s.tarjeta_bloqueada === 1;
        return `
          <div class="admin-student-row ${isBlocked ? 'is-blocked' : ''}">
            <!-- DATOS PRINCIPALES DEL ESTUDIANTE -->
            <div style="display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1;">
              <div style="width: 42px; height: 42px; border-radius: 50%; border: 2px solid ${isBlocked ? '#fca5a5' : '#0284c7'}; background: ${isBlocked ? '#fee2e2' : 'linear-gradient(135deg, #0284c7, #0369a1)'}; color: ${isBlocked ? '#dc2626' : '#ffffff'}; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 0.95rem;">
                ${getStudentInitials(s.nombre_completo)}
              </div>
              <div style="min-width: 0; flex: 1;">
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                  <strong style="font-size: 0.95rem; font-weight: 800; color: var(--text-main); line-height: 1.2;">${s.nombre_completo}</strong>
                  ${isBlocked 
                    ? '<span class="saas-status-badge saas-status-blocked"><span class="saas-dot"></span>Suspendida</span>' 
                    : '<span class="saas-status-badge saas-status-active"><span class="saas-dot"></span>Activa</span>'
                  }
                </div>
                <div style="display: flex; align-items: center; gap: 8px; font-size: 0.74rem; color: var(--text-muted); margin-top: 3px; flex-wrap: wrap;">
                  <span style="background: rgba(148, 163, 184, 0.15); padding: 1px 7px; border-radius: 5px; font-weight: 700; color: var(--text-main);">${s.grado} • ${s.seccion}</span>
                  <span style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">Cód: <strong style="color: var(--text-main);">${s.codigo_estudiante}</strong></span>
                  <span>PIN: <strong style="color: var(--text-main);">${s.pin_seguridad || '1234'}</strong></span>
                </div>
              </div>
            </div>

            <!-- MÉTRICAS FINANCIERAS -->
            <div style="display: flex; flex-direction: column; align-items: flex-end; padding: 0 10px; flex-shrink: 0;">
              <div style="font-size: 1.05rem; font-weight: 900; color: #10b981; line-height: 1.2;">₡${s.saldo_colones.toLocaleString('es-CR')}</div>
              <div style="font-size: 0.7rem; color: var(--text-muted); font-weight: 600; margin-top: 2px;">Límite: ₡${s.limite_diario_colones.toLocaleString('es-CR')}/día</div>
            </div>

            <!-- BARRA DE ACCIONES SAAS ELEGANTE -->
            <div class="admin-student-actions">
              <button type="button" class="btn-saas btn-saas-primary" onclick="quickGoToRecarga(${s.id})" title="Cargar saldo en caja a este estudiante">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
                <span>Recargar</span>
              </button>

              <a href="/carnet.html?id=${s.id}" target="_blank" class="btn-saas btn-saas-outline" title="Ver e imprimir carné físico escolar">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 7h.01"/><path d="M11 7h6"/><path d="M7 11h.01"/><path d="M11 11h6"/><path d="M7 15h.01"/><path d="M11 15h6"/></svg>
                <span>Carné QR</span>
              </a>

              <button type="button" class="btn-saas ${isBlocked ? 'btn-saas-success-subtle' : 'btn-saas-danger-subtle'}" onclick="toggleBlockCard(${s.id}, ${isBlocked ? 0 : 1})" title="${isBlocked ? 'Desbloquear y restablecer tarjeta' : 'Bloquear tarjeta por extravío o reporte'}">
                ${isBlocked 
                  ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
                     <span>Desbloquear</span>`
                  : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                     <span>Bloquear</span>`
                }
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

  const tipoEl = document.getElementById('newEstTipo');
  const prefijo = tipoEl ? tipoEl.value : 'EST';

  const btn = document.getElementById('btnSubmitNewStudent');
  btn.disabled = true;
  btn.textContent = 'Creando usuario y carné...';

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
        padre_telefono: tel,
        prefijo
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (window.sounds) window.sounds.playSuccess();
    alert(`¡Estudiante Creado con Éxito!\nNombre: ${data.nombre_completo}\nCódigo: ${data.codigo_estudiante}\nQR Token: ${data.qr_token}`);

    closeNewStudentModal();
    document.getElementById('formNewStudent').reset();
    await loadAdminData();
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    alert(`Error al crear estudiante: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> <span>Guardar y Generar Carné</span>';
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
        No se encontró ningún estudiante con "<strong>${query}</strong>"
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
      <span>${query ? `Resultados para "${query}" (${list.length})` : `Estudiantes Registrados (${list.length})`}:</span>
      <span style="color: #0284c7;">${displayList.length < list.length ? `Mostrando primeros ${displayList.length}` : 'Todos'}</span>
    </div>
    ${displayList.map(s => {
      const isSelected = adminSelectedStudent && adminSelectedStudent.id === s.id;
      return `
        <div class="admin-search-item ${isSelected ? 'selected' : ''}" onclick="selectAdminStudent(${s.id}, true)">
          <div style="width: 38px; height: 38px; border-radius: 50%; background: ${isSelected ? 'linear-gradient(135deg, #0284c7, #0369a1)' : '#e0f2fe'}; color: ${isSelected ? '#ffffff' : '#0369a1'}; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 0.85rem; border: 2px solid ${isSelected ? '#0284c7' : '#cbd5e1'}; flex-shrink: 0;">
            ${getStudentInitials(s.nombre_completo)}
          </div>
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

  if (avatar) {
    if (avatar.tagName === 'IMG') {
      avatar.src = student.foto_url || '/img/avatar_default.png';
    } else {
      avatar.textContent = getStudentInitials(student.nombre_completo);
    }
  }
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
    statusEl.textContent = 'Enfoca el código QR del carné';
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
            statusEl.textContent = '¡Código detectado! Verificando...';
            statusEl.style.color = '#166534';
            statusEl.style.background = '#dcfce7';
          }

          handleAdminQrDetected(detected).then(success => {
            if (!success) {
              setTimeout(() => {
                isProcessingAdminScan = false;
                if (statusEl && isScanAdminLoopRunning) {
                  statusEl.textContent = 'Enfoca el código QR del carné';
                  statusEl.style.color = '#0284c7';
                  statusEl.style.background = '#e0f2fe';
                }
              }, 1500);
            }
          }).catch(err => {
            console.error('Error no capturado en detección:', err);
            isProcessingAdminScan = false;
            if (statusEl && isScanAdminLoopRunning) {
              statusEl.textContent = 'Enfoca el código QR del carné';
              statusEl.style.color = '#0284c7';
              statusEl.style.background = '#e0f2fe';
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
      statusEl.textContent = 'Cámara no disponible. Digita el carné abajo o búscalo arriba.';
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

  try {
    if (window.sounds && typeof window.sounds.playScanChirp === 'function') {
      window.sounds.playScanChirp();
    }
  } catch (e) {}

  try {
    const parsed = parseScannedStudentToken(token);
    const clean = (parsed || '').toLowerCase();

    if (statusEl) {
      statusEl.textContent = 'Verificando estudiante...';
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
    if (!student && parsed) {
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
    if (!student && parsed !== token && token) {
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

      try {
        if (window.sounds && typeof window.sounds.playSuccess === 'function') {
          window.sounds.playSuccess();
        }
      } catch (e) {}
      return true;
    } else {
      // Si no se encontró, NO cerrar el modal: dar feedback visual claro
      try {
        if (window.sounds && typeof window.sounds.playError === 'function') {
          window.sounds.playError();
        }
      } catch (e) {}
      if (statusEl) {
        statusEl.textContent = `Código no reconocido: "${String(parsed || token).slice(0, 20)}". Enfoca de nuevo.`;
        statusEl.style.color = '#dc2626';
        statusEl.style.background = '#fee2e2';
      }
      return false;
    }
  } catch (err) {
    console.error('Error crítico en handleAdminQrDetected:', err);
    if (statusEl) {
      statusEl.textContent = 'Error al verificar estudiante. Intenta de nuevo.';
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
    alert(`${data.mensaje}\nNuevo Saldo: ₡${data.saldo_nuevo.toLocaleString('es-CR')}`);

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
    alert(`Error al recargar: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> <span>Aplicar Recarga Inmediata</span>';
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
        Cargando movimientos recientes...
      </div>
    `;

    const res = await fetch('/api/admin/movimientos?limit=100');
    if (!res.ok) throw new Error('Error al cargar movimientos desde el servidor');
    adminMovimientosData = await res.json();
    renderAdminMovimientos();
  } catch (err) {
    console.error('Error cargando movimientos:', err);
    container.innerHTML = `<div style="text-align: center; color: #ef4444; padding: 25px; font-weight: 700;">Error al cargar el historial: ${err.message}</div>`;
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
        <div style="display: flex; justify-content: center; margin-bottom: 8px;"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity: 0.4;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div>
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
      tipoBadge = `<span style="background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; font-size: 0.7rem; font-weight: 800; padding: 3px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/></svg> Recarga Efectivo</span>`;
    } else if (m.tipo === 'recarga_sinpe') {
      tipoBadge = `<span style="background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; font-size: 0.7rem; font-weight: 800; padding: 3px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg> Recarga SINPE</span>`;
    } else if (m.tipo === 'compra_mostrador' || m.tipo === 'preorden') {
      tipoBadge = `<span style="background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; font-size: 0.7rem; font-weight: 800; padding: 3px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg> Cobro Soda</span>`;
    } else if (m.tipo === 'reversion_recarga') {
      tipoBadge = `<span style="background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; font-size: 0.7rem; font-weight: 800; padding: 3px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/></svg> Reversión Recarga (Eliminación)</span>`;
    } else if (m.tipo === 'reembolso') {
      tipoBadge = `<span style="background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; font-size: 0.7rem; font-weight: 800; padding: 3px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/></svg> Reembolso Compra</span>`;
    } else {
      tipoBadge = `<span style="background: #f1f5f9; color: #475569; font-size: 0.7rem; font-weight: 800; padding: 3px 8px; border-radius: 6px;">${m.tipo.toUpperCase()}</span>`;
    }

    // Formato de hora
    let fechaHoraStr = m.fecha || '';
    try {
      const d = new Date(m.fecha.includes('Z') ? m.fecha : m.fecha.replace(' ', 'T') + 'Z');
      fechaHoraStr = d.toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' }) + ' • ' + d.toLocaleDateString('es-CR', { day: '2-digit', month: 'short' });
    } catch (e) {}

    // Monto formateado: Estilo sutil idéntico a "Revertir" / "Revertido" (rojo suave) y verde suave
    const absMonto = Math.abs(m.monto_colones);
    const montoDisplay = isPositive ? `+₡${absMonto.toLocaleString('es-CR')}` : `-₡${absMonto.toLocaleString('es-CR')}`;
    const montoColor = isPositive ? '#166534' : '#991b1b';
    const montoBg = isPositive ? '#f0fdf4' : '#fef2f2';
    const montoBorder = isPositive ? '#bbf7d0' : '#fecaca';
    const montoIcon = isPositive 
      ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>'
      : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>';

    // Regla de 10 min para Cajero
    const minutos = parseFloat(m.minutos_transcurridos) || 0;
    const canRevertTime = !isCajero || minutos <= 10;

    // Botón de acción / Estado
    let actionHtml = '';
    if (isRevertida) {
      actionHtml = `
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="display: inline-flex; align-items: center; gap: 4px; background: #fee2e2; color: #991b1b; padding: 4px 9px; border-radius: 7px; font-size: 0.72rem; font-weight: 900; border: 1px solid #fca5a5;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Revertido
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
          Admin (+10m)
        </button>
      `;
    } else {
      const cleanName = (m.estudiante_nombre || '').replace(/'/g, "\\'");
      actionHtml = `
        <button type="button" class="btn-saas btn-saas-danger-subtle" onclick="revertirMovimientoAdmin(${m.id}, ${absMonto}, '${cleanName}', '${m.tipo}')" title="Revertir este movimiento">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>
          <span>Revertir</span>
        </button>
      `;
    }

    // Avatar o círculo con iniciales: SIEMPRE celeste según requerimiento
    const initials = getStudentInitials(m.estudiante_nombre);
    let avatarHtml = '';
    if (m.estudiante_foto && m.estudiante_foto.trim() !== '' && !m.estudiante_foto.includes('avatar_default.png')) {
      avatarHtml = `
        <div style="width: 44px; height: 44px; border-radius: 50%; border: 2px solid #0284c7; overflow: hidden; flex-shrink: 0; box-shadow: 0 2px 6px rgba(2, 132, 199, 0.2);">
          <img src="${m.estudiante_foto}" alt="${m.estudiante_nombre}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.parentElement.outerHTML='<div style=\\\'width: 44px; height: 44px; border-radius: 50%; border: 2px solid #bae6fd; background: linear-gradient(135deg, #0284c7, #0ea5e9); color: #ffffff; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 0.95rem; box-shadow: 0 2px 6px rgba(2, 132, 199, 0.2); letter-spacing: 0.5px;\\\'>${initials}</div>'">
        </div>
      `;
    } else {
      avatarHtml = `
        <div style="width: 44px; height: 44px; border-radius: 50%; border: 2px solid #bae6fd; background: linear-gradient(135deg, #0284c7, #0ea5e9); color: #ffffff; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 0.95rem; box-shadow: 0 2px 6px rgba(2, 132, 199, 0.2); letter-spacing: 0.5px;">
          ${initials}
        </div>
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
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 2px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${fechaHoraStr}
          </span>
        </div>

        <!-- FILA CENTRAL: ALUMNO Y DETALLES -->
        <div style="display: flex; align-items: center; gap: 12px; min-width: 0;">
          ${avatarHtml}
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
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px; vertical-align: -2px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>${m.descripcion}
              </div>
            ` : ''}
          </div>
        </div>

        <!-- FILA INFERIOR: MONTO, SALDO POSTERIOR Y BOTÓN DE ACCIÓN -->
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; background: rgba(148, 163, 184, 0.07); border: 1px solid var(--border); border-radius: 10px; padding: 8px 12px; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
            <div style="display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 8px; background: ${montoBg}; border: 1px solid ${montoBorder}; color: ${montoColor}; font-weight: 800; font-size: 0.95rem; box-shadow: 0 1px 2px rgba(0,0,0,0.02);">
              <span style="display: inline-flex; align-items: center; gap: 4px; ${isRevertida ? 'text-decoration: line-through; opacity: 0.6;' : ''}">
                ${montoIcon}
                <span>${montoDisplay}</span>
              </span>
            </div>
            <span style="font-size: 0.74rem; color: var(--text-muted); font-weight: 700;">
              Saldo posterior: <strong style="color: var(--text-main); font-weight: 800;">₡${(m.saldo_posterior || 0).toLocaleString('es-CR')}</strong>
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
    `${efectoTexto}\n\n` +
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
    alert(`Reversión Exitosa:\n${data.mensaje}`);

    await loadAdminMovimientos();
    await loadAdminData();
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    alert(`No se pudo revertir el movimiento:\n${err.message}`);
  }
}

// ==========================================
// GESTIÓN DE PRODUCTOS (ADMIN)
// ==========================================

async function populateCategorySelect(selectedId) {
  const select = document.getElementById('adminProdCategoria');
  if (!select) return;

  if (!categories || categories.length === 0) {
    try {
      const res = await fetch('/api/productos');
      const data = await res.json();
      if (data && data.categorias) categories = data.categorias;
    } catch (e) {
      console.warn('Error al cargar categorías:', e);
    }
  }

  select.innerHTML = (categories || []).map(c => `
    <option value="${c.id}" ${selectedId && Number(selectedId) === Number(c.id) ? 'selected' : ''}>
      ${c.nombre}
    </option>
  `).join('');
}

function selectProdIcon(emoji) {
  const input = document.getElementById('adminProdIcono');
  if (input) input.value = emoji;
}

function toggleStockInput(checked) {
  const box = document.getElementById('boxProdStockCount');
  if (box) box.style.display = checked ? 'block' : 'none';
}

function openCreateProductModal() {
  const modal = document.getElementById('modalAdminProduct');
  if (!modal) return;

  document.getElementById('modalProductTitle').textContent = 'Crear Nuevo Producto';
  document.getElementById('adminProdId').value = '';
  document.getElementById('adminProdNombre').value = '';
  document.getElementById('adminProdPrecio').value = '';
  document.getElementById('adminProdIcono').value = '🥪';
  document.getElementById('adminProdDescripcion').value = '';
  document.getElementById('adminProdControlStock').checked = true;
  toggleStockInput(true);
  document.getElementById('adminProdStock').value = '15';
  document.getElementById('adminProdMep').value = '1';

  const btnDel = document.getElementById('btnDeleteProduct');
  if (btnDel) btnDel.style.display = 'none';

  const btnSubmit = document.getElementById('btnSaveProductSubmit');
  if (btnSubmit) btnSubmit.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> <span>Guardar Producto</span>';

  populateCategorySelect();
  modal.style.display = 'flex';
  if (window.sounds) window.sounds.playTap();
}

function openEditProductModal(prodId) {
  const modal = document.getElementById('modalAdminProduct');
  if (!modal) return;

  const prod = (adminProducts || []).find(p => p.id === prodId) || (products || []).find(p => p.id === prodId);
  if (!prod) {
    alert('No se encontró la información del producto.');
    return;
  }

  document.getElementById('modalProductTitle').textContent = 'Editar Producto';
  document.getElementById('adminProdId').value = prod.id;
  document.getElementById('adminProdNombre').value = prod.nombre || '';
  document.getElementById('adminProdPrecio').value = prod.precio_colones || 0;
  document.getElementById('adminProdIcono').value = prod.icono || '🥪';
  document.getElementById('adminProdDescripcion').value = prod.descripcion || '';
  
  const hasControl = prod.control_stock === 1;
  document.getElementById('adminProdControlStock').checked = hasControl;
  toggleStockInput(hasControl);
  document.getElementById('adminProdStock').value = prod.stock !== undefined ? prod.stock : 0;
  document.getElementById('adminProdMep').value = (prod.cumple_mep !== undefined ? prod.cumple_mep : 1);

  const btnDel = document.getElementById('btnDeleteProduct');
  if (btnDel) btnDel.style.display = 'inline-block';

  const btnSubmit = document.getElementById('btnSaveProductSubmit');
  if (btnSubmit) btnSubmit.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> <span>Actualizar Producto</span>';

  populateCategorySelect(prod.categoria_id);
  modal.style.display = 'flex';
  if (window.sounds) window.sounds.playTap();
}

function closeAdminProductModal(event) {
  if (event && event.target !== event.currentTarget) return;
  const modal = document.getElementById('modalAdminProduct');
  if (modal) modal.style.display = 'none';
}

async function submitAdminProduct(e) {
  if (e) e.preventDefault();

  const idVal = document.getElementById('adminProdId').value;
  const nombre = document.getElementById('adminProdNombre').value.trim();
  const categoria_id = parseInt(document.getElementById('adminProdCategoria').value, 10);
  const precio_colones = parseInt(document.getElementById('adminProdPrecio').value, 10);
  const icono = document.getElementById('adminProdIcono').value.trim() || '🥪';
  const descripcion = document.getElementById('adminProdDescripcion').value.trim();
  const control_stock = document.getElementById('adminProdControlStock').checked ? 1 : 0;
  const stock = parseInt(document.getElementById('adminProdStock').value, 10) || 0;
  const cumple_mep = parseInt(document.getElementById('adminProdMep').value, 10);

  if (!nombre || isNaN(precio_colones) || precio_colones <= 0 || isNaN(categoria_id)) {
    alert('Por favor ingresa un nombre y precio válidos.');
    return;
  }

  const payload = {
    nombre,
    categoria_id,
    precio_colones,
    icono,
    descripcion,
    control_stock,
    stock,
    cumple_mep
  };

  const isEdit = !!idVal;
  const url = isEdit ? `/api/admin/productos/${idVal}` : '/api/admin/productos';
  const method = isEdit ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar producto');

    if (window.sounds) window.sounds.playSuccess();
    closeAdminProductModal();
    await loadAdminData();

    if (typeof loadInitialData === 'function') {
      loadInitialData();
    }
    alert(isEdit ? 'Producto actualizado correctamente.' : 'Producto creado exitosamente.');
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    alert(`Error: ${err.message}`);
  }
}

async function handleDeleteProduct() {
  const idVal = document.getElementById('adminProdId').value;
  if (!idVal) return;

  const prodNombre = document.getElementById('adminProdNombre').value.trim();
  const conf = confirm(`¿Estás seguro de eliminar o desactivar "${prodNombre}"?\n\nSi tiene ventas históricas asociadas se desactivará para proteger el reporte contable. Si es nuevo, se eliminará permanentemente.`);
  if (!conf) return;

  try {
    const res = await fetch(`/api/admin/productos/${idVal}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al eliminar producto');

    if (window.sounds) window.sounds.playSuccess();
    closeAdminProductModal();
    await loadAdminData();
    if (typeof loadInitialData === 'function') {
      loadInitialData();
    }
    alert(data.mensaje || 'Producto procesado correctamente.');
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    alert(`Error: ${err.message}`);
  }
}

// ==========================================
// GESTIÓN DE PERSONAL Y CAJEROS (ADMIN)
// ==========================================

async function loadAdminStaff() {
  const container = document.getElementById('adminStaffList');
  if (!container) return;

  try {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 24px; font-size: 0.88rem;">
        Cargando personal de la soda...
      </div>
    `;

    const res = await fetch('/api/admin/personal');
    if (!res.ok) throw new Error('Error al cargar la lista de personal');
    adminStaffList = await res.json();
    renderAdminStaff(adminStaffList);
  } catch (err) {
    console.error('Error cargando personal:', err);
    container.innerHTML = `
      <div style="text-align: center; color: #dc2626; padding: 20px;">
        Error al cargar personal: ${err.message}
      </div>
    `;
  }
}

function renderAdminStaff(list) {
  const container = document.getElementById('adminStaffList');
  if (!container) return;

  if (!list || list.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 24px; color: var(--text-muted);">
        No hay personal registrado en el sistema.
      </div>
    `;
    return;
  }

  container.innerHTML = list.map(s => {
    const isRootAdmin = (s.id === 1);
    const isBlocked = (s.activo === 0);

    // Iniciales del empleado para el avatar elegante
    const initials = (s.nombre || 'U')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(w => w[0].toUpperCase())
      .join('') || 'U';

    let roleSvg = '';
    let roleLabel = 'Personal';
    if (s.rol === 'admin') {
      roleLabel = 'Administrador';
      roleSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
    } else if (s.rol === 'cajero') {
      roleLabel = 'Cajero POS';
      roleSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>`;
    } else {
      roleLabel = 'Vendedor Despacho';
      roleSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`;
    }

    return `
      <div class="admin-staff-card ${isBlocked ? 'blocked' : ''}">
        <div style="display: flex; align-items: center; gap: 14px; min-width: 0; flex: 1;">
          <div class="staff-initials-avatar">
            ${initials}
          </div>
          <div style="min-width: 0; flex: 1;">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <strong style="font-size: 0.95rem; font-weight: 800; color: var(--text-main); line-height: 1.2;">${s.nombre}</strong>
              <span class="staff-role-badge staff-role-${s.rol}">${roleSvg} ${roleLabel}</span>
              ${isBlocked 
                ? '<span class="saas-status-badge saas-status-blocked"><span class="saas-dot"></span>Bloqueado</span>' 
                : '<span class="saas-status-badge saas-status-active"><span class="saas-dot"></span>Activo</span>'
              }
            </div>
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 3px; display: flex; align-items: center; flex-wrap: wrap; gap: 12px;">
              <span style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">Usuario: <strong style="color: var(--text-main);">@${s.username}</strong></span>
              ${s.telefono ? `
                <span style="display: inline-flex; align-items: center; gap: 4px;">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                  ${s.telefono}
                </span>` : ''}
              ${s.email ? `
                <span style="display: inline-flex; align-items: center; gap: 4px;">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                  ${s.email}
                </span>` : ''}
            </div>
          </div>
        </div>

        <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0; flex-wrap: wrap;">
          <button type="button" class="btn-saas btn-saas-outline" onclick="openEditStaffModal(${s.id})" title="Editar datos del personal">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
            <span>Editar</span>
          </button>
          ${!isRootAdmin ? `
            <button type="button" class="btn-saas ${isBlocked ? 'btn-saas-success-subtle' : 'btn-saas-danger-subtle'}" onclick="toggleBlockStaff(${s.id}, ${isBlocked ? 1 : 0})" title="${isBlocked ? 'Desbloquear acceso al sistema' : 'Bloquear acceso al sistema'}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="${isBlocked ? 'M7 11V7a5 5 0 0 1 9.9-1' : 'M7 11V7a5 5 0 0 1 10 0v4'}"/></svg>
              <span>${isBlocked ? 'Desbloquear' : 'Bloquear'}</span>
            </button>
            <button type="button" class="btn-saas btn-saas-danger-subtle" onclick="deleteStaff(${s.id}, '${s.nombre.replace(/'/g, "\\'")}')" title="Eliminar empleado">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
              <span>Eliminar</span>
            </button>
          ` : `
            <span class="saas-status-badge saas-status-active" style="font-size: 0.7rem;">
              <span class="saas-dot"></span> Principal
            </span>
          `}
        </div>
      </div>
    `;
  }).join('');
}

function openCreateStaffModal() {
  const modal = document.getElementById('modalAdminStaff');
  if (!modal) return;

  document.getElementById('modalStaffTitle').textContent = 'Nuevo Empleado / Cajero';
  document.getElementById('adminStaffId').value = '';
  document.getElementById('adminStaffNombre').value = '';
  
  const userInput = document.getElementById('adminStaffUsername');
  userInput.value = '';
  userInput.disabled = false;
  userInput.style.opacity = '1';

  document.getElementById('adminStaffRol').value = 'cajero';
  
  const passInput = document.getElementById('adminStaffPassword');
  passInput.value = '';
  passInput.required = true;
  document.getElementById('lblStaffPassword').textContent = 'Contraseña de Acceso *:';
  document.getElementById('hintStaffPassword').style.display = 'none';

  document.getElementById('adminStaffTel').value = '';
  document.getElementById('adminStaffEmail').value = '';

  const btnSubmit = document.getElementById('btnSaveStaffSubmit');
  if (btnSubmit) btnSubmit.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> <span>Guardar Empleado</span>';

  modal.style.display = 'flex';
  if (window.sounds) window.sounds.playTap();
}

function openEditStaffModal(staffId) {
  const modal = document.getElementById('modalAdminStaff');
  if (!modal) return;

  const staff = (adminStaffList || []).find(s => s.id === staffId);
  if (!staff) {
    alert('No se encontró el empleado especificado.');
    return;
  }

  document.getElementById('modalStaffTitle').textContent = 'Editar Empleado / Cajero';
  document.getElementById('adminStaffId').value = staff.id;
  document.getElementById('adminStaffNombre').value = staff.nombre || '';
  
  const userInput = document.getElementById('adminStaffUsername');
  userInput.value = staff.username || '';
  userInput.disabled = true;
  userInput.style.opacity = '0.7';

  document.getElementById('adminStaffRol').value = staff.rol || 'cajero';
  if (staff.id === 1) {
    document.getElementById('adminStaffRol').value = 'admin';
  }

  const passInput = document.getElementById('adminStaffPassword');
  passInput.value = '';
  passInput.required = false;
  document.getElementById('lblStaffPassword').textContent = 'Nueva Contraseña (opcional):';
  document.getElementById('hintStaffPassword').style.display = 'block';

  document.getElementById('adminStaffTel').value = staff.telefono || '';
  document.getElementById('adminStaffEmail').value = staff.email || '';

  const btnSubmit = document.getElementById('btnSaveStaffSubmit');
  if (btnSubmit) btnSubmit.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> <span>Actualizar Datos</span>';

  modal.style.display = 'flex';
  if (window.sounds) window.sounds.playTap();
}

function closeAdminStaffModal(event) {
  if (event && event.target !== event.currentTarget) return;
  const modal = document.getElementById('modalAdminStaff');
  if (modal) modal.style.display = 'none';
}

async function submitAdminStaff(e) {
  if (e) e.preventDefault();

  const idVal = document.getElementById('adminStaffId').value;
  const nombre = document.getElementById('adminStaffNombre').value.trim();
  const username = document.getElementById('adminStaffUsername').value.trim().toLowerCase();
  const rol = document.getElementById('adminStaffRol').value;
  const password = document.getElementById('adminStaffPassword').value.trim();
  const telefono = document.getElementById('adminStaffTel').value.trim();
  const email = document.getElementById('adminStaffEmail').value.trim().toLowerCase();

  if (!nombre) {
    alert('El nombre es obligatorio.');
    return;
  }

  const isEdit = !!idVal;
  if (!isEdit && (!username || !password)) {
    alert('Usuario y contraseña son obligatorios para crear un nuevo empleado.');
    return;
  }

  const payload = {
    nombre,
    rol,
    telefono,
    email
  };

  if (!isEdit) {
    payload.username = username;
    payload.password = password;
  } else if (password) {
    payload.password = password;
  }

  const url = isEdit ? `/api/admin/personal/${idVal}` : '/api/admin/personal';
  const method = isEdit ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al procesar empleado');

    if (window.sounds) window.sounds.playSuccess();
    closeAdminStaffModal();
    await loadAdminStaff();
    alert(isEdit ? 'Datos de empleado actualizados correctamente.' : 'Empleado creado exitosamente con credenciales de acceso.');
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    alert(`Error: ${err.message}`);
  }
}

async function toggleBlockStaff(staffId, nuevoEstado) {
  const accion = (nuevoEstado === 1) ? 'desbloquear' : 'bloquear';
  const conf = confirm(`¿Estás seguro de ${accion.toUpperCase()} el acceso de este empleado a RecreoPay?`);
  if (!conf) return;

  try {
    const res = await fetch(`/api/admin/personal/${staffId}/estado`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activo: nuevoEstado })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al cambiar estado del empleado');

    if (window.sounds) window.sounds.playSuccess();
    await loadAdminStaff();
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    alert(`Error: ${err.message}`);
  }
}

async function deleteStaff(staffId, nombre) {
  const conf = confirm(`PELIGRO:\n¿Estás completamente seguro de ELIMINAR definitivamente al empleado "${nombre}"?\n\nEsta acción no se puede deshacer y perderá el acceso al sistema.`);
  if (!conf) return;

  try {
    const res = await fetch(`/api/admin/personal/${staffId}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al eliminar empleado');

    if (window.sounds) window.sounds.playSuccess();
    await loadAdminStaff();
    alert(data.mensaje || 'Empleado eliminado correctamente.');
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    alert(`Error: ${err.message}`);
  }
}

// ==========================================
// COLECCIÓN Y PERSONALIZACIÓN DE DISEÑOS DE TARJETA VIRTUAL
// ==========================================

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

let systemCardDesigns = [];

async function loadCardDesigns() {
  try {
    const res = await fetch('/api/disenos-tarjetas');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        systemCardDesigns = data;
      }
    }
  } catch (err) {
    console.warn('Usando catálogo base de diseños de tarjetas:', err);
  }
}

function getActiveCardThemesList() {
  if (systemCardDesigns && systemCardDesigns.length > 0) {
    return systemCardDesigns.map(d => {
      let icon = '🌐';
      let catName = 'Unisex';
      if (d.categoria === 'fem') { icon = '🌸'; catName = 'Femenino'; }
      else if (d.categoria === 'masc') { icon = '🚀'; catName = 'Masculino'; }
      return {
        id: d.theme_id,
        name: d.nombre,
        category: catName,
        icon: icon,
        desc: `Diseño oficial RecreoPay (${catName})`,
        imagen_url: d.imagen_url,
        estilo_texto: d.estilo_texto || 'dark',
        es_predeterminado: d.es_predeterminado ? 1 : 0
      };
    });
  }

  // Fallback a los 16 iniciales si la API aún no ha respondido
  return [
    { id: 'card_robo_lab', name: 'Robo-Lab Tech', category: 'Unisex', icon: '🤖', desc: 'Circuitos y robótica futurista', imagen_url: '/img/cards/card_robo_lab.jpg', estilo_texto: 'dark', es_predeterminado: 1 },
    { id: 'card_fem_gatito', name: 'Gatito Tierno', category: 'Femenino', icon: '🐱', desc: 'Tierno gatito kawaii', imagen_url: '/img/cards/card_fem_gatito.jpg', estilo_texto: 'light' },
    { id: 'card_fem_unicornio', name: 'Unicornio Ensueño', category: 'Femenino', icon: '🦄', desc: 'Unicornio mágico pastel', imagen_url: '/img/cards/card_fem_unicornio.svg', estilo_texto: 'light' },
    { id: 'card_fem_sirena', name: 'Océano Sirena', category: 'Femenino', icon: '🧜‍♀️', desc: 'Fantasía marina', imagen_url: '/img/cards/card_fem_sirena.svg', estilo_texto: 'light' },
    { id: 'card_fem_gamer', name: 'Gamer Pastel', category: 'Femenino', icon: '🎮', desc: 'Gamer girl estética pastel', imagen_url: '/img/cards/card_fem_gamer.svg', estilo_texto: 'light' },
    { id: 'card_fem_ballet', name: 'Ballet Danza', category: 'Femenino', icon: '🩰', desc: 'Elegancia y danza', imagen_url: '/img/cards/card_fem_ballet.svg', estilo_texto: 'light' },
    { id: 'card_fem_mariposas', name: 'Jardín Mariposas', category: 'Femenino', icon: '🦋', desc: 'Naturaleza primaveral', imagen_url: '/img/cards/card_fem_mariposas.svg', estilo_texto: 'light' },
    { id: 'card_estrellas_futbol', name: 'Estrellas de Fútbol', category: 'Masculino', icon: '⚽', desc: 'Pasión por el fútbol', imagen_url: '/img/cards/card_estrellas_futbol.jpg', estilo_texto: 'dark' },
    { id: 'card_eco_aventura', name: 'Eco-Aventura', category: 'Masculino', icon: '🌲', desc: 'Exploración y aire libre', imagen_url: '/img/cards/card_eco_aventura.jpg', estilo_texto: 'light' },
    { id: 'card_pixel_quest', name: 'Pixel Quest', category: 'Masculino', icon: '👾', desc: 'Arcade 8 bits retro', imagen_url: '/img/cards/card_pixel_quest.jpg', estilo_texto: 'dark' },
    { id: 'card_exploracion_galactica', name: 'Exploración Galáctica', category: 'Masculino', icon: '🚀', desc: 'Viaje a través del cosmos', imagen_url: '/img/cards/card_exploracion_galactica.jpg', estilo_texto: 'dark' },
    { id: 'card_masc_skate', name: 'Skate Park', category: 'Masculino', icon: '🛹', desc: 'Estilo urbano street', imagen_url: '/img/cards/card_masc_skate.svg', estilo_texto: 'light' },
    { id: 'card_masc_carreras', name: 'Super Carreras', category: 'Masculino', icon: '🏎️', desc: 'Velocidad y motores', imagen_url: '/img/cards/card_masc_carreras.svg', estilo_texto: 'dark' },
    { id: 'card_mundo_arte', name: 'Mundo de Arte', category: 'Unisex', icon: '🎨', desc: 'Creatividad y pintura', imagen_url: '/img/cards/card_mundo_arte.jpg', estilo_texto: 'light' },
    { id: 'card_uni_musica', name: 'Ritmo & Beats (DJ)', category: 'Unisex', icon: '🎧', desc: 'Música electrónica y neón', imagen_url: '/img/cards/card_uni_musica.svg', estilo_texto: 'dark' },
    { id: 'card_uni_titanium', name: 'Titanium Edition', category: 'Unisex', icon: '⚡', desc: 'Minimalismo de titanio', imagen_url: '/img/cards/card_uni_titanium.svg', estilo_texto: 'dark' }
  ];
}

function getSavedCardTheme() {
  const themes = getActiveCardThemesList();
  if (currentStudent && currentStudent.id) {
    const studentTheme = localStorage.getItem(`recreopay_card_theme_${currentStudent.id}`);
    if (studentTheme && themes.some(t => t.id === studentTheme)) {
      return studentTheme;
    }
  }
  const globalTheme = localStorage.getItem('recreopay_card_theme');
  if (globalTheme && themes.some(t => t.id === globalTheme)) {
    return globalTheme;
  }
  const defaultTheme = themes.find(t => t.es_predeterminado) || themes[0];
  return defaultTheme ? defaultTheme.id : 'card_robo_lab';
}

function applyCardTheme(themeId) {
  const card = document.getElementById('mainWalletCard');
  if (!card) return;

  const themes = getActiveCardThemesList();
  let chosen = themes.find(t => t.id === themeId);
  if (!chosen) {
    chosen = themes.find(t => t.es_predeterminado) || themes[0];
  }
  const validThemeId = chosen ? chosen.id : 'card_robo_lab';

  // Quitar clases previas de tema
  themes.forEach(t => {
    card.classList.remove(`theme-${t.id}`);
  });
  card.classList.remove('has-custom-bg', 'card-style-light', 'card-style-dark');

  if (chosen && chosen.imagen_url) {
    card.classList.add('has-custom-bg');
    card.style.backgroundImage = `url('${chosen.imagen_url}')`;
    if (chosen.estilo_texto === 'light') {
      card.classList.add('card-style-light');
    } else {
      card.classList.add('card-style-dark');
    }
  } else {
    card.style.backgroundImage = '';
    card.classList.add(`theme-${validThemeId}`);
  }
}

async function openCardDesignModal() {
  const modal = document.getElementById('modalCardDesigns');
  if (!modal) return;

  await loadCardDesigns();
  renderCardDesignsCarousel();
  setupCarouselScrollListener();
  modal.style.display = 'flex';

  const themes = getActiveCardThemesList();
  const currentTheme = getSavedCardTheme();
  const currentIdx = themes.findIndex(t => t.id === currentTheme);
  if (currentIdx >= 0) {
    setTimeout(() => {
      jumpToCardSlide(currentIdx);
    }, 60);
  }

  if (window.sounds) window.sounds.playTap();
}

function closeCardDesignModal(event) {
  if (event && event.target !== event.currentTarget) return;
  const modal = document.getElementById('modalCardDesigns');
  if (modal) modal.style.display = 'none';
}

function renderCardDesignsCarousel() {
  const container = document.getElementById('cardCarouselContainer');
  const dotsContainer = document.getElementById('carouselDots');
  const strip = document.getElementById('themeQuickStrip');
  if (!container) return;

  const themes = getActiveCardThemesList();
  const currentTheme = getSavedCardTheme();
  const avatarUrl = (currentStudent && currentStudent.foto_url) ? currentStudent.foto_url : 'https://api.dicebear.com/7.x/bottts/svg?seed=est';
  const studentName = (currentStudent && currentStudent.nombre_completo) ? currentStudent.nombre_completo : 'Mateo Alvarado Castro';
  const studentGrade = (currentStudent && currentStudent.grado) ? `${currentStudent.grado} • Sección ${currentStudent.seccion || 'A'} • Cód: ${currentStudent.codigo_estudiante || 'EST-001'}` : '2° Grado • Sección 2-A • Cód: EST-2026-001';
  const studentBalance = (currentStudent && currentStudent.saldo_colones !== undefined) ? currentStudent.saldo_colones.toLocaleString('es-CR') : '5.300';

  container.innerHTML = themes.map((t, idx) => {
    const isSelected = (t.id === currentTheme);
    const bgStyle = t.imagen_url ? `background-image: url('${t.imagen_url}');` : '';
    const contrastClass = t.estilo_texto === 'light' ? 'card-style-light' : 'card-style-dark';

    return `
      <div class="card-carousel-slide" data-index="${idx}" data-theme="${t.id}">
        <!-- Vista previa de la tarjeta real (SIN ASTERISCOS) -->
        <div class="wallet-card has-custom-bg ${contrastClass}" style="margin: 0; cursor: pointer; transition: transform 0.2s; ${bgStyle}" onclick="selectCardTheme('${t.id}')">
          <div class="card-chip-container">
            <div class="card-emv-chip">
              <div class="chip-inner-circuit"></div>
            </div>
            <div class="card-contactless-wave"><span>)</span><span>)</span><span>)</span></div>
          </div>
          <div class="student-info">
            <div class="student-avatar">${getStudentInitials(studentName)}</div>
            <div class="student-meta" style="flex: 1; min-width: 0;">
              <h2 style="margin: 0; font-size: 1.05rem; font-weight: 800; word-break: break-word;">${studentName}</h2>
              <span class="student-grade" style="font-size: 0.72rem;">${studentGrade}</span>
            </div>
          </div>
          <div class="balance-row">
            <div class="balance-col">
              <div class="label" style="font-size: 0.68rem; font-weight: 800;">SALDO DISPONIBLE</div>
              <div class="amount">
                <span style="font-size: 1.35rem; font-weight: 900;">₡${studentBalance}</span>
              </div>
            </div>
            <div style="display: flex; gap: 4px; align-items: center;">
              <span class="preview-card-badge">QR</span>
              <span class="preview-card-badge">Pasar</span>
            </div>
          </div>
        </div>

        <!-- Info del tema y botón de selección -->
        <div style="margin-top: 10px; display: flex; justify-content: space-between; align-items: center; gap: 8px;">
          <div style="min-width: 0; flex: 1;">
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              <strong style="font-size: 0.95rem; color: var(--text-main);">${t.name}</strong>
              <span style="font-size: 0.68rem; font-weight: 800; padding: 2px 7px; border-radius: 6px; background: rgba(2, 132, 199, 0.1); color: #0284c7;">${t.category}</span>
            </div>
            <p style="margin: 2px 0 0 0; font-size: 0.72rem; color: var(--text-muted); line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${t.desc}</p>
          </div>
          <div style="flex-shrink: 0;">
            <button type="button" id="btnSelectTheme_${t.id}" onclick="selectCardTheme('${t.id}')" style="padding: 7px 15px; border-radius: 10px; font-weight: 900; font-size: 0.8rem; cursor: pointer; white-space: nowrap; border: none; ${isSelected ? 'background: #10b981; color: white;' : 'background: #0284c7; color: white;'}">
              ${isSelected ? 'Activo' : 'Elegir'}
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (dotsContainer) {
    dotsContainer.innerHTML = themes.map((t, idx) => `
      <div class="carousel-dot ${t.id === currentTheme ? 'active' : ''}" id="dotSlide_${idx}" onclick="jumpToCardSlide(${idx})" title="${t.name}"></div>
    `).join('');
  }

  if (strip) {
    strip.innerHTML = themes.map((t, idx) => `
      <button type="button" class="theme-pill-btn ${t.id === currentTheme ? 'active' : ''}" id="pillTheme_${t.id}" onclick="jumpToCardSlide(${idx})">
        <span>${t.name}</span>
      </button>
    `).join('');
  }
}

function scrollCardCarousel(direction) {
  const container = document.getElementById('cardCarouselContainer');
  if (!container) return;
  const slideWidth = container.clientWidth;
  container.scrollBy({ left: direction * slideWidth, behavior: 'smooth' });
}

function jumpToCardSlide(index) {
  const container = document.getElementById('cardCarouselContainer');
  if (!container) return;
  const slide = container.querySelector(`[data-index="${index}"]`);
  if (slide) {
    slide.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }

  const themes = getActiveCardThemesList();
  document.querySelectorAll('.carousel-dot').forEach((d, idx) => {
    d.classList.toggle('active', idx === index);
  });
  if (themes[index]) {
    const themeId = themes[index].id;
    document.querySelectorAll('.theme-pill-btn').forEach(p => {
      p.classList.toggle('active', p.id === `pillTheme_${themeId}`);
    });
  }
}

function setupCarouselScrollListener() {
  const container = document.getElementById('cardCarouselContainer');
  if (!container || container.dataset.hasListener) return;
  container.dataset.hasListener = 'true';

  let scrollTimeout = null;
  container.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      const themes = getActiveCardThemesList();
      const scrollLeft = container.scrollLeft;
      const slideWidth = container.clientWidth;
      if (slideWidth > 0) {
        const activeIdx = Math.max(0, Math.min(themes.length - 1, Math.round(scrollLeft / slideWidth)));

        document.querySelectorAll('.carousel-dot').forEach((d, idx) => {
          d.classList.toggle('active', idx === activeIdx);
        });

        if (themes[activeIdx]) {
          const themeId = themes[activeIdx].id;
          document.querySelectorAll('.theme-pill-btn').forEach(p => {
            p.classList.toggle('active', p.id === `pillTheme_${themeId}`);
          });
        }
      }
    }, 40);
  }, { passive: true });
}

function selectCardTheme(themeId) {
  if (!themeId) return;

  const themes = getActiveCardThemesList();
  localStorage.setItem('recreopay_card_theme', themeId);
  if (currentStudent && currentStudent.id) {
    localStorage.setItem(`recreopay_card_theme_${currentStudent.id}`, themeId);
  }

  applyCardTheme(themeId);

  themes.forEach(t => {
    const btn = document.getElementById(`btnSelectTheme_${t.id}`);
    if (btn) {
      if (t.id === themeId) {
        btn.textContent = 'Activo';
        btn.style.background = '#10b981';
      } else {
        btn.textContent = 'Elegir';
        btn.style.background = '#0284c7';
      }
    }

    const pill = document.getElementById(`pillTheme_${t.id}`);
    if (pill) {
      pill.classList.toggle('active', t.id === themeId);
    }
  });

  if (window.sounds) window.sounds.playCoin();
}


// ==========================================
// DEVELOPER MASTER SUITE: CONTROL TOTAL DE USUARIOS, DISEÑOS Y DIAGNÓSTICO
// ==========================================

let devAllUsers = [];
let devUploadedBase64 = null;
let devAllDisenos = [];

// 1. GESTIÓN DE USUARIOS & ADMINISTRADORES
async function loadDevUsuarios() {
  const tbody = document.getElementById('devUsersTableBody');
  if (!tbody) return;

  try {
    tbody.innerHTML = `<tr><td colspan="7" style="padding: 24px; text-align: center; color: var(--text-muted);">Cargando usuarios del sistema...</td></tr>`;
    const res = await fetch('/api/developer/usuarios');
    if (!res.ok) throw new Error('Error al cargar usuarios');
    devAllUsers = await res.json();
    renderDevUsuarios(devAllUsers);
    renderDevUserStats(devAllUsers);
  } catch (err) {
    console.error('Error cargando usuarios dev:', err);
    tbody.innerHTML = `<tr><td colspan="7" style="padding: 24px; text-align: center; color: #ef4444;">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderDevUserStats(users) {
  const strip = document.getElementById('devUserStatsStrip');
  if (!strip) return;
  const counts = { total: users.length, admin: 0, developer: 0, cajero: 0, vendedor: 0, padre: 0, estudiante: 0 };
  users.forEach(u => {
    if (counts[u.rol] !== undefined) counts[u.rol]++;
  });

  strip.innerHTML = `
    <div style="background: var(--card-bg, #ffffff); border: 1.5px solid var(--border, #e2e8f0); border-radius: 10px; padding: 7px 14px; font-size: 0.78rem; font-weight: 700; white-space: nowrap; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
      Total: <span style="color: #0284c7; font-weight: 800;">${counts.total}</span>
    </div>
    <div style="background: var(--card-bg, #ffffff); border: 1.5px solid var(--border, #e2e8f0); border-radius: 10px; padding: 7px 14px; font-size: 0.78rem; font-weight: 700; white-space: nowrap; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
      Admins: <span style="color: #0f172a; font-weight: 800;">${counts.admin}</span>
    </div>
    <div style="background: var(--card-bg, #ffffff); border: 1.5px solid var(--border, #e2e8f0); border-radius: 10px; padding: 7px 14px; font-size: 0.78rem; font-weight: 700; white-space: nowrap; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
      Devs: <span style="color: #0284c7; font-weight: 800;">${counts.developer}</span>
    </div>
    <div style="background: var(--card-bg, #ffffff); border: 1.5px solid var(--border, #e2e8f0); border-radius: 10px; padding: 7px 14px; font-size: 0.78rem; font-weight: 700; white-space: nowrap; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
      Cajeros: <span style="color: #475569; font-weight: 800;">${counts.cajero}</span>
    </div>
    <div style="background: var(--card-bg, #ffffff); border: 1.5px solid var(--border, #e2e8f0); border-radius: 10px; padding: 7px 14px; font-size: 0.78rem; font-weight: 700; white-space: nowrap; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
      Padres: <span style="color: #0284c7; font-weight: 800;">${counts.padre}</span>
    </div>
    <div style="background: var(--card-bg, #ffffff); border: 1.5px solid var(--border, #e2e8f0); border-radius: 10px; padding: 7px 14px; font-size: 0.78rem; font-weight: 700; white-space: nowrap; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
      Estudiantes: <span style="color: #64748b; font-weight: 800;">${counts.estudiante}</span>
    </div>
  `;
}

function filterDevUsuarios() {
  const query = (document.getElementById('devUserSearchInput')?.value || '').toLowerCase().trim();
  const role = document.getElementById('devUserRoleFilter')?.value || 'all';

  const filtered = devAllUsers.filter(u => {
    const matchRole = (role === 'all' || u.rol === role);
    const matchQuery = !query || 
      (u.username && u.username.toLowerCase().includes(query)) ||
      (u.nombre && u.nombre.toLowerCase().includes(query)) ||
      (u.email && u.email.toLowerCase().includes(query)) ||
      (u.rol && u.rol.toLowerCase().includes(query)) ||
      (u.estudiante_codigo && u.estudiante_codigo.toLowerCase().includes(query));
    return matchRole && matchQuery;
  });

  renderDevUsuarios(filtered);
}

function renderDevUsuarios(users) {
  const tbody = document.getElementById('devUsersTableBody');
  if (!tbody) return;

  if (users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding: 24px; text-align: center; color: var(--text-muted);">No se encontraron usuarios</td></tr>`;
    return;
  }

  tbody.innerHTML = users.map(u => {
    let roleBadge = '';
    if (u.rol === 'developer') roleBadge = '<span class="dev-role-badge role-developer">Developer</span>';
    else if (u.rol === 'admin') roleBadge = '<span class="dev-role-badge role-admin">Admin Soda</span>';
    else if (u.rol === 'cajero') roleBadge = '<span class="dev-role-badge role-cajero">Cajero</span>';
    else if (u.rol === 'vendedor') roleBadge = '<span class="dev-role-badge role-vendedor">Vendedor</span>';
    else if (u.rol === 'padre') roleBadge = '<span class="dev-role-badge role-padre">Padre</span>';
    else if (u.rol === 'estudiante') roleBadge = '<span class="dev-role-badge role-estudiante">Estudiante</span>';
    else roleBadge = `<span class="dev-role-badge">${escapeHtml(u.rol)}</span>`;

    const statusBadge = u.activo ? 
      `<span style="color: #16a34a; font-weight: 700; background: #f0fdf4; border: 1px solid #bbf7d0; padding: 3px 8px; border-radius: 6px; font-size: 0.72rem;">● Activo</span>` :
      `<span style="color: #64748b; font-weight: 700; background: #f8fafc; border: 1px solid #e2e8f0; padding: 3px 8px; border-radius: 6px; font-size: 0.72rem;">Inactivo</span>`;

    let extraInfo = '';
    if (u.rol === 'estudiante' && u.estudiante_codigo) {
      extraInfo = `<div style="font-size: 0.72rem; color: #0284c7; font-weight: 700;">Carné: ${escapeHtml(u.estudiante_codigo)} · ${escapeHtml(u.estudiante_grado || '')}</div>`;
    } else if (u.rol === 'padre' && u.hijos_vinculados) {
      extraInfo = `<div style="font-size: 0.72rem; color: #64748b; font-weight: 700;">Hijos: ${escapeHtml(u.hijos_vinculados)}</div>`;
    }

    return `
      <tr style="border-bottom: 1px solid var(--border); transition: background 0.15s;" onmouseover="this.style.background='var(--bg-main)'" onmouseout="this.style.background='transparent'">
        <td style="padding: 10px 14px; font-weight: 800; color: var(--text-muted); font-size: 0.76rem;">#${u.id}</td>
        <td style="padding: 10px 14px; font-weight: 800; color: var(--text-main);">
          ${escapeHtml(u.username)}
          ${extraInfo}
        </td>
        <td style="padding: 10px 14px; color: var(--text-main); font-weight: 600;">${escapeHtml(u.nombre || '-')}</td>
        <td style="padding: 10px 14px;">${roleBadge}</td>
        <td style="padding: 10px 14px; font-size: 0.76rem; color: var(--text-muted);">
          ${u.telefono ? `<span style="display:inline-flex;align-items:center;gap:4px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>${escapeHtml(u.telefono)}</span><br>` : ''}
          ${u.email ? `<span style="display:inline-flex;align-items:center;gap:4px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>${escapeHtml(u.email)}</span>` : (!u.telefono ? '-' : '')}
        </td>
        <td style="padding: 10px 14px;">${statusBadge}</td>
        <td style="padding: 10px 14px; text-align: right; white-space: nowrap;">
          <div style="display: inline-flex; gap: 4px;">
            <button onclick="openModalDevUser(${u.id})" class="dev-action-btn" style="padding: 5px 9px; font-size: 0.75rem; display: inline-flex; align-items: center; gap: 4px;" title="Modificar datos del usuario">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg> Editar
            </button>
            <button onclick="openModalDevPassword(${u.id}, '${escapeHtml(u.username)}')" class="dev-action-btn" style="padding: 5px 9px; font-size: 0.75rem; color: #0284c7; display: inline-flex; align-items: center; gap: 4px;" title="Cambiar contraseña">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></svg> Clave
            </button>
            <button onclick="toggleDevUserStatus(${u.id}, ${u.activo ? 0 : 1})" class="dev-action-btn" style="padding: 5px 9px; font-size: 0.75rem; color: #475569; display: inline-flex; align-items: center; gap: 4px;" title="${u.activo ? 'Desactivar usuario' : 'Activar usuario'}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> ${u.activo ? 'Bloquear' : 'Activar'}
            </button>
            <button onclick="deleteDevUser(${u.id}, '${escapeHtml(u.username)}')" class="dev-action-btn dev-action-btn-danger" style="padding: 5px 9px; font-size: 0.75rem; display: inline-flex; align-items: center;" title="Eliminar usuario">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function openModalDevUser(userId = null) {
  const modal = document.getElementById('modalDevUser');
  const title = document.getElementById('modalDevUserTitle');
  const idInput = document.getElementById('devUserId');
  const userInput = document.getElementById('devInputUsername');
  const rolInput = document.getElementById('devInputRol');
  const nombreInput = document.getElementById('devInputNombre');
  const pwdInput = document.getElementById('devInputPassword');
  const pwdHelp = document.getElementById('devPasswordHelp');
  const telInput = document.getElementById('devInputTelefono');
  const emailInput = document.getElementById('devInputEmail');

  if (userId) {
    const user = devAllUsers.find(u => u.id === userId);
    if (!user) return;
    title.textContent = `Editar Usuario: ${user.username}`;
    idInput.value = user.id;
    userInput.value = user.username;
    rolInput.value = user.rol;
    nombreInput.value = user.nombre;
    pwdInput.value = '';
    pwdInput.required = false;
    if (pwdHelp) pwdHelp.style.display = 'block';
    telInput.value = user.telefono || '';
    emailInput.value = user.email || '';
  } else {
    title.textContent = 'Crear Nuevo Usuario / Admin';
    idInput.value = '';
    userInput.value = '';
    rolInput.value = 'admin';
    nombreInput.value = '';
    pwdInput.value = '';
    pwdInput.required = true;
    if (pwdHelp) pwdHelp.style.display = 'none';
    telInput.value = '';
    emailInput.value = '';
  }

  modal.style.display = 'flex';
}

function closeModalDevUser(event) {
  if (event && event.target !== event.currentTarget) return;
  const modal = document.getElementById('modalDevUser');
  if (modal) modal.style.display = 'none';
}

async function saveDevUser(e) {
  e.preventDefault();
  const userId = document.getElementById('devUserId').value;
  const username = document.getElementById('devInputUsername').value.trim();
  const rol = document.getElementById('devInputRol').value;
  const nombre = document.getElementById('devInputNombre').value.trim();
  const password = document.getElementById('devInputPassword').value;
  const telefono = document.getElementById('devInputTelefono').value.trim();
  const email = document.getElementById('devInputEmail').value.trim();

  try {
    let url = '/api/developer/usuarios';
    let method = 'POST';
    const payload = { username, rol, nombre, telefono, email };

    if (userId) {
      url = `/api/developer/usuarios/${userId}`;
      method = 'PUT';
      if (password) payload.password = password;
    } else {
      if (!password) {
        alert('Debes ingresar una contraseña para el nuevo usuario');
        return;
      }
      payload.password = password;
    }

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar usuario');

    closeModalDevUser();
    await loadDevUsuarios();
    if (window.sounds) window.sounds.playSuccess();
    alert(userId ? 'Usuario actualizado con éxito' : 'Usuario creado con éxito');
  } catch (err) {
    console.error('Error guardando usuario:', err);
    if (window.sounds) window.sounds.playError();
    alert(err.message);
  }
}

function openModalDevPassword(userId, username) {
  const modal = document.getElementById('modalDevPassword');
  const targetLabel = document.getElementById('devPwdTargetUser');
  const idInput = document.getElementById('devPwdUserId');
  const pwdInput = document.getElementById('devInputNewPassword');

  idInput.value = userId;
  targetLabel.textContent = `Usuario: ${username}`;
  pwdInput.value = '';
  modal.style.display = 'flex';
}

function closeModalDevPassword(event) {
  if (event && event.target !== event.currentTarget) return;
  const modal = document.getElementById('modalDevPassword');
  if (modal) modal.style.display = 'none';
}

async function saveDevPassword(e) {
  e.preventDefault();
  const userId = document.getElementById('devPwdUserId').value;
  const password = document.getElementById('devInputNewPassword').value;

  if (!password || password.length < 4) {
    alert('La contraseña debe tener al menos 4 caracteres');
    return;
  }

  try {
    const res = await fetch(`/api/developer/usuarios/${userId}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al cambiar contraseña');

    closeModalDevPassword();
    if (window.sounds) window.sounds.playSuccess();
    alert('Contraseña actualizada correctamente');
  } catch (err) {
    console.error('Error cambiando contraseña:', err);
    if (window.sounds) window.sounds.playError();
    alert(err.message);
  }
}

async function toggleDevUserStatus(userId, activo) {
  try {
    const res = await fetch(`/api/developer/usuarios/${userId}/estado`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activo })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error cambiando estado');
    await loadDevUsuarios();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteDevUser(userId, username) {
  if (!confirm(`¿Estás seguro de que deseas eliminar permanentemente al usuario "${username}"?`)) {
    return;
  }

  try {
    const res = await fetch(`/api/developer/usuarios/${userId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error eliminando usuario');
    await loadDevUsuarios();
    if (window.sounds) window.sounds.playTrash();
  } catch (err) {
    alert(err.message);
  }
}

// 2. GESTIÓN Y SUBIDA DE DISEÑOS DE TARJETAS
function handleDevCardFileSelect(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  if (file.size > 20 * 1024 * 1024) {
    alert('El archivo es demasiado grande (máximo 20MB)');
    return;
  }

  const reader = new FileReader();
  reader.onload = (event) => {
    devUploadedBase64 = event.target.result;
    document.getElementById('devUploadPrompt').style.display = 'none';
    const successEl = document.getElementById('devUploadSuccess');
    successEl.style.display = 'block';
    document.getElementById('devUploadFileName').textContent = file.name;
    
    // Auto-sugerir nombre si está vacío
    const nameInput = document.getElementById('devCardName');
    if (!nameInput.value) {
      const cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
      nameInput.value = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
    }

    updateDevCardLivePreview();
  };
  reader.readAsDataURL(file);
}

function updateDevCardLivePreview() {
  const name = document.getElementById('devCardName').value || 'Nombre del Diseño';
  const textStyle = document.getElementById('devCardTextStyle').value;
  const previewImg = document.getElementById('devLiveCardBgImg');
  const title = document.getElementById('devLiveCardThemeTitle');
  const cardName = document.getElementById('devLiveCardName');
  const cardGrade = document.getElementById('devLiveCardGrade');
  const cardBalVal = document.getElementById('devLiveCardBalValue');
  const cardBalLbl = document.getElementById('devLiveCardBalLabel');
  const cardBrand = document.getElementById('devLiveCardBrand');

  if (title) title.textContent = `${name} (Vista Previa)`;
  if (devUploadedBase64 && previewImg) {
    previewImg.src = devUploadedBase64;
  }

  // Ajustar contraste dinámico de la vista previa
  if (textStyle === 'light') {
    if (cardName) { cardName.style.color = '#0f172a'; cardName.style.textShadow = '0 1px 2px rgba(255,255,255,0.9)'; }
    if (cardGrade) { cardGrade.style.color = '#334155'; cardGrade.style.textShadow = 'none'; }
    if (cardBalVal) { cardBalVal.style.color = '#047857'; cardBalVal.style.textShadow = '0 1px 2px rgba(255,255,255,0.8)'; }
    if (cardBalLbl) { cardBalLbl.style.color = '#334155'; }
    if (cardBrand) { cardBrand.style.color = '#0f172a'; cardBrand.style.textShadow = '0 1px 2px rgba(255,255,255,0.8)'; }
  } else {
    if (cardName) { cardName.style.color = '#ffffff'; cardName.style.textShadow = '0 2px 8px rgba(0,0,0,0.9)'; }
    if (cardGrade) { cardGrade.style.color = '#cbd5e1'; cardGrade.style.textShadow = '0 2px 6px rgba(0,0,0,0.9)'; }
    if (cardBalVal) { cardBalVal.style.color = '#4ade80'; cardBalVal.style.textShadow = '0 2px 10px rgba(0,0,0,0.95)'; }
    if (cardBalLbl) { cardBalLbl.style.color = '#cbd5e1'; }
    if (cardBrand) { cardBrand.style.color = '#ffffff'; cardBrand.style.textShadow = '0 2px 8px rgba(0,0,0,0.8)'; }
  }
}

async function saveDevCardDesign(e) {
  e.preventDefault();
  const name = document.getElementById('devCardName').value.trim();
  const categoria = document.getElementById('devCardCategory').value;
  const estilo_texto = document.getElementById('devCardTextStyle').value;
  const submitBtn = document.getElementById('btnDevSubmitCard');

  if (!devUploadedBase64) {
    alert('Por favor selecciona una imagen para el diseño de la tarjeta');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Guardando y publicando...';

  try {
    const res = await fetch('/api/developer/disenos-tarjetas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: name,
        categoria: categoria,
        estilo_texto: estilo_texto,
        image_base64: devUploadedBase64
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar diseño');

    // Limpiar formulario
    devUploadedBase64 = null;
    document.getElementById('formDevCardDesign').reset();
    document.getElementById('devUploadPrompt').style.display = 'block';
    document.getElementById('devUploadSuccess').style.display = 'none';
    document.getElementById('devLiveCardBgImg').src = '/img/cards/card_robo_lab.jpg';

    if (window.sounds) window.sounds.playSuccess();
    alert('¡Diseño guardado y publicado con éxito! Ya está disponible para todos los estudiantes.');

    await loadDevDisenos();
    await loadCardDesigns();
  } catch (err) {
    console.error('Error guardando tarjeta:', err);
    if (window.sounds) window.sounds.playError();
    alert(err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg> <span>Guardar y Publicar Diseño</span>';
  }
}

async function loadDevDisenos() {
  const grid = document.getElementById('devDisenosGrid');
  const countEl = document.getElementById('devDisenosCount');
  if (!grid) return;

  try {
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 24px; color: var(--text-muted);">Cargando catálogo de diseños...</div>';
    const res = await fetch('/api/developer/disenos-tarjetas');
    if (!res.ok) throw new Error('Error al cargar diseños');
    devAllDisenos = await res.json();
    if (countEl) countEl.textContent = devAllDisenos.length;
    renderDevDisenosGrid(devAllDisenos);
  } catch (err) {
    console.error('Error cargando diseños dev:', err);
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 24px; color: #ef4444;">Error: ${escapeHtml(err.message)}</div>`;
  }
}

function filterDevDisenosGrid(category, btn) {
  if (btn) {
    btn.parentElement.querySelectorAll('.dev-action-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }

  const filtered = (category === 'all') ? devAllDisenos : devAllDisenos.filter(d => d.categoria === category);
  renderDevDisenosGrid(filtered);
}

function renderDevDisenosGrid(disenos) {
  const grid = document.getElementById('devDisenosGrid');
  if (!grid) return;

  if (disenos.length === 0) {
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 24px; color: var(--text-muted);">No hay diseños en esta categoría</div>';
    return;
  }

  grid.innerHTML = disenos.map(d => {
    let catLabel = 'Unisex';
    if (d.categoria === 'fem') catLabel = 'Femenino';
    if (d.categoria === 'masc') catLabel = 'Masculino';

    const statusBadge = d.activo ?
      `<span style="color: #16a34a; font-weight: 700; font-size: 0.72rem; background: #f0fdf4; border: 1px solid #bbf7d0; padding: 2px 7px; border-radius: 6px;">● Activo</span>` :
      `<span style="color: #64748b; font-weight: 700; font-size: 0.72rem; background: #f8fafc; border: 1px solid #e2e8f0; padding: 2px 7px; border-radius: 6px;">Inactivo</span>`;

    const textColorLabel = (d.estilo_texto === 'light') ? 'Texto Oscuro' : 'Texto Blanco';

    return `
      <div style="background: var(--card-bg, #ffffff); border: 1.5px solid var(--border, #e2e8f0); border-radius: 14px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.04); display: flex; flex-direction: column;">
        <div style="position: relative; aspect-ratio: 1.586; overflow: hidden; background: #0f172a;">
          <img src="${escapeHtml(d.imagen_url)}" alt="${escapeHtml(d.nombre)}" style="width: 100%; height: 100%; object-fit: cover; display: block;" onerror="this.src='/img/cards/card_robo_lab.jpg'">
          <div style="position: absolute; top: 8px; left: 8px; background: rgba(15, 23, 42, 0.75); color: white; font-size: 0.68rem; font-weight: 700; padding: 2px 8px; border-radius: 6px; backdrop-filter: blur(4px);">
            ${catLabel}
          </div>
          <div style="position: absolute; top: 8px; right: 8px;">
            ${statusBadge}
          </div>
        </div>
        <div style="padding: 14px; flex: 1; display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div style="font-weight: 800; font-size: 0.92rem; color: var(--text-main); margin-bottom: 4px;">
              ${escapeHtml(d.nombre)}
            </div>
            <div style="font-size: 0.72rem; color: var(--text-muted); display: flex; align-items: center; gap: 8px;">
              <span>${textColorLabel}</span>
              ${d.es_predeterminado ? '<span style="color: #0284c7; font-weight: 700; background: #f0f9ff; border: 1px solid #bae6fd; padding: 1px 6px; border-radius: 4px;">Predeterminado</span>' : ''}
            </div>
          </div>
          <div style="margin-top: 12px; display: flex; gap: 6px; justify-content: flex-end;">
            <button onclick="toggleDevCardStatus(${d.id}, ${d.activo ? 0 : 1})" class="dev-action-btn" style="padding: 5px 10px; font-size: 0.75rem;">
              ${d.activo ? 'Desactivar' : 'Activar'}
            </button>
            <button onclick="deleteDevCardDesign(${d.id}, '${escapeHtml(d.nombre)}')" class="dev-action-btn dev-action-btn-danger" style="padding: 5px 9px; font-size: 0.75rem; display: inline-flex; align-items: center;" title="Eliminar diseño">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function toggleDevCardStatus(id, activo) {
  try {
    const res = await fetch(`/api/developer/disenos-tarjetas/${id}/estado`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activo })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error cambiando estado');
    await loadDevDisenos();
    await loadCardDesigns();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteDevCardDesign(id, nombre) {
  if (!confirm(`¿Eliminar el diseño "${nombre}"? Los estudiantes ya no podrán seleccionarlo.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/developer/disenos-tarjetas/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error eliminando diseño');
    await loadDevDisenos();
    await loadCardDesigns();
    if (window.sounds) window.sounds.playTrash();
  } catch (err) {
    alert(err.message);
  }
}

// 3. DIAGNÓSTICO Y MÉTRICAS DEL SISTEMA & BD
async function loadDevStats() {
  const container = document.getElementById('devStatsContainer');
  if (!container) return;

  try {
    const res = await fetch('/api/developer/stats');
    if (!res.ok) throw new Error('Error al obtener estadísticas');
    const s = await res.json();

    const sec = s.sistema?.uptime_segundos || 0;
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const uptimeStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins} min (${sec % 60}s)`;

    container.innerHTML = `
      <div style="background: var(--card-bg, #ffffff); border: 1.5px solid var(--border, #e2e8f0); border-radius: 14px; padding: 18px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 0.74rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.3px;">Tiempo Activo</span>
          <div style="width: 32px; height: 32px; border-radius: 8px; background: #f0f9ff; color: #0284c7; display: flex; align-items: center; justify-content: center;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
        </div>
        <div style="font-size: 1.35rem; font-weight: 900; color: #0284c7; margin-top: 8px;">${uptimeStr}</div>
        <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 3px;">Node.js ${escapeHtml(s.sistema?.node_version || '')}</div>
      </div>
      <div style="background: var(--card-bg, #ffffff); border: 1.5px solid var(--border, #e2e8f0); border-radius: 14px; padding: 18px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 0.74rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.3px;">Memoria RAM</span>
          <div style="width: 32px; height: 32px; border-radius: 8px; background: #f8fafc; color: #475569; display: flex; align-items: center; justify-content: center; border: 1px solid #e2e8f0;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/></svg>
          </div>
        </div>
        <div style="font-size: 1.35rem; font-weight: 900; color: #0f172a; margin-top: 8px;">${s.sistema?.memoria_mb || 0} MB</div>
        <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 3px;">Consumo de Proceso Node</div>
      </div>
      <div style="background: var(--card-bg, #ffffff); border: 1.5px solid var(--border, #e2e8f0); border-radius: 14px; padding: 18px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 0.74rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.3px;">Base de Datos</span>
          <div style="width: 32px; height: 32px; border-radius: 8px; background: #f0fdf4; color: #16a34a; display: flex; align-items: center; justify-content: center; border: 1px solid #bbf7d0;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/></svg>
          </div>
        </div>
        <div style="font-size: 1.35rem; font-weight: 900; color: #0f172a; margin-top: 8px;">${escapeHtml(s.sistema?.db_size_formatted || (s.sistema?.db_size_kb ? s.sistema.db_size_kb + ' KB' : '9.5 MB'))}</div>
        <div style="font-size: 0.72rem; color: #16a34a; font-weight: 700; margin-top: 3px;">● ${escapeHtml(s.sistema?.db_tipo || 'PostgreSQL')} (Estable)</div>
      </div>
      <div style="background: var(--card-bg, #ffffff); border: 1.5px solid var(--border, #e2e8f0); border-radius: 14px; padding: 18px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 0.74rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.3px;">Usuarios Registrados</span>
          <div style="width: 32px; height: 32px; border-radius: 8px; background: #f0f9ff; color: #0284c7; display: flex; align-items: center; justify-content: center; border: 1px solid #bae6fd;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </div>
        </div>
        <div style="font-size: 1.35rem; font-weight: 900; color: #0284c7; margin-top: 8px;">${s.usuarios?.total || 0} Cuentas</div>
        <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 3px;">${s.estudiantes?.total || 0} Alumnos vinculados</div>
      </div>
      <div style="background: var(--card-bg, #ffffff); border: 1.5px solid var(--border, #e2e8f0); border-radius: 14px; padding: 18px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 0.74rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.3px;">Diseños de Tarjetas</span>
          <div style="width: 32px; height: 32px; border-radius: 8px; background: #f8fafc; color: #475569; display: flex; align-items: center; justify-content: center; border: 1px solid #e2e8f0;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
          </div>
        </div>
        <div style="font-size: 1.35rem; font-weight: 900; color: #0f172a; margin-top: 8px;">${s.negocio?.disenos_tarjetas_activas || 0} Activos</div>
        <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 3px;">Disponibles para alumnos</div>
      </div>
      <div style="background: var(--card-bg, #ffffff); border: 1.5px solid var(--border, #e2e8f0); border-radius: 14px; padding: 18px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 0.74rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.3px;">Pedidos en Soda</span>
          <div style="width: 32px; height: 32px; border-radius: 8px; background: #f0f9ff; color: #0284c7; display: flex; align-items: center; justify-content: center; border: 1px solid #bae6fd;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
          </div>
        </div>
        <div style="font-size: 1.35rem; font-weight: 900; color: #0284c7; margin-top: 8px;">${s.negocio?.ordenes_totales || 0} Órdenes</div>
        <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 3px;">${s.negocio?.transacciones_totales || 0} Transacciones totales</div>
      </div>
    `;
  } catch (err) {
    console.error('Error cargando stats dev:', err);
    container.innerHTML = `<div style="grid-column: 1/-1; color: #ef4444;">Error cargando métricas: ${escapeHtml(err.message)}</div>`;
  }
}

// ==========================================
// 4. GESTIÓN MULTI-ESCUELA / MULTI-TENANT (DEVELOPER MASTER)
// ==========================================

let devAllEscuelas = [];

async function loadDevEscuelas() {
  const grid = document.getElementById('devEscuelasGrid');
  if (!grid) return;

  try {
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 30px;">Cargando centros educativos y sedes...</div>';
    const res = await fetch('/api/developer/escuelas');
    if (!res.ok) throw new Error('Error al consultar escuelas');
    devAllEscuelas = await res.json();
    renderDevEscuelasSummary(devAllEscuelas);
    renderDevEscuelas(devAllEscuelas);
  } catch (err) {
    console.error('Error cargando escuelas:', err);
    grid.innerHTML = `<div style="grid-column: 1/-1; color: #ef4444; text-align: center; padding: 20px;">Error: ${escapeHtml(err.message)}</div>`;
  }
}

function renderDevEscuelasSummary(escuelas) {
  const strip = document.getElementById('devEscuelasSummaryStrip');
  if (!strip) return;

  const totalSedes = escuelas.length;
  const totalAlumnos = escuelas.reduce((sum, e) => sum + (parseInt(e.total_estudiantes, 10) || 0), 0);
  const totalProds = escuelas.reduce((sum, e) => sum + (parseInt(e.total_productos, 10) || 0), 0);
  const totalVentas = escuelas.reduce((sum, e) => sum + (parseFloat(e.ventas_totales) || 0), 0);

  strip.innerHTML = `
    <div style="background: var(--card-bg, #ffffff); border: 1.5px solid var(--border, #e2e8f0); border-radius: 12px; padding: 12px 16px; flex: 1; min-width: 150px; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
      <span style="font-size: 0.72rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">Sedes Activas</span>
      <div style="font-size: 1.35rem; font-weight: 900; color: #0284c7; margin-top: 4px;">${totalSedes}</div>
    </div>
    <div style="background: var(--card-bg, #ffffff); border: 1.5px solid var(--border, #e2e8f0); border-radius: 12px; padding: 12px 16px; flex: 1; min-width: 150px; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
      <span style="font-size: 0.72rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">Total Estudiantes</span>
      <div style="font-size: 1.35rem; font-weight: 900; color: #0f172a; margin-top: 4px;">${totalAlumnos}</div>
    </div>
    <div style="background: var(--card-bg, #ffffff); border: 1.5px solid var(--border, #e2e8f0); border-radius: 12px; padding: 12px 16px; flex: 1; min-width: 150px; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
      <span style="font-size: 0.72rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">Platillos en Catálogos</span>
      <div style="font-size: 1.35rem; font-weight: 900; color: #0284c7; margin-top: 4px;">${totalProds}</div>
    </div>
    <div style="background: var(--card-bg, #ffffff); border: 1.5px solid var(--border, #e2e8f0); border-radius: 12px; padding: 12px 16px; flex: 1; min-width: 150px; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
      <span style="font-size: 0.72rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">Facturación Global</span>
      <div style="font-size: 1.35rem; font-weight: 900; color: #0f172a; margin-top: 4px;">₡${totalVentas.toLocaleString('es-CR')}</div>
    </div>
  `;
}

function renderDevEscuelas(escuelas) {
  const grid = document.getElementById('devEscuelasGrid');
  if (!grid) return;

  if (escuelas.length === 0) {
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 40px;">No hay escuelas registradas aún. Presiona "+ Dar de Alta Nueva Escuela".</div>';
    return;
  }

  grid.innerHTML = escuelas.map(e => {
    const isActivo = e.activo !== 0;
    const ventas = parseFloat(e.ventas_totales) || 0;
    const prods = parseInt(e.total_productos, 10) || 0;
    const ests = parseInt(e.total_estudiantes, 10) || 0;
    const ords = parseInt(e.total_ordenes, 10) || 0;

    return `
      <div style="background: var(--card-bg, #ffffff); border: 1.5px solid ${isActivo ? 'var(--border, #e2e8f0)' : '#fecaca'}; border-radius: 16px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); display: flex; flex-direction: column; justify-content: space-between; transition: all 0.2s;">
        <div>
          <!-- Cabecera de la Sede -->
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 14px;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <div style="width: 44px; height: 44px; border-radius: 12px; background: #f0f9ff; color: #0284c7; border: 1px solid #bae6fd; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"/><path d="M9 21v-4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4"/><line x1="9" y1="9" x2="9" y2="9.01"/><line x1="15" y1="9" x2="15" y2="9.01"/></svg>
              </div>
              <div>
                <h4 style="margin: 0; font-size: 1.05rem; font-weight: 800; color: var(--text-main);">${escapeHtml(e.nombre)}</h4>
                <div style="display: flex; gap: 6px; align-items: center; margin-top: 3px;">
                  <span style="font-size: 0.72rem; font-weight: 700; background: #f0f9ff; color: #0284c7; border: 1px solid #bae6fd; padding: 2px 8px; border-radius: 6px;">CÓD: ${escapeHtml(e.codigo)}</span>
                  <span style="font-size: 0.72rem; font-weight: 700; color: var(--text-muted);">ID #${e.id}</span>
                </div>
              </div>
            </div>
            <span style="font-size: 0.70rem; font-weight: 700; padding: 3px 8px; border-radius: 6px; background: ${isActivo ? '#f0fdf4' : '#f8fafc'}; color: ${isActivo ? '#166534' : '#64748b'}; border: 1px solid ${isActivo ? '#bbf7d0' : '#e2e8f0'};">
              ${isActivo ? '● ACTIVA' : 'PAUSADA'}
            </span>
          </div>

          <!-- Datos de Operación y SINPE -->
          <div style="background: var(--bg-main, #f8fafc); border: 1px solid var(--border, #e2e8f0); border-radius: 10px; padding: 10px 12px; margin-bottom: 14px; font-size: 0.8rem; line-height: 1.5;">
            <div><strong>SINPE Móvil:</strong> <span style="color: #0284c7; font-weight: 800;">${escapeHtml(e.telefono_sinpe || 'No configurado')}</span> (${escapeHtml(e.nombre_sinpe || e.nombre)})</div>
            <div style="margin-top: 3px; color: var(--text-muted);"><strong>Operador:</strong> ${escapeHtml(e.concesionario || 'Administración de la Soda')}</div>
          </div>

          <!-- Métricas de la Sede -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px;">
            <div style="background: var(--bg-main, #f8fafc); border-radius: 8px; padding: 8px 10px; border: 1px solid var(--border, #e2e8f0);">
              <span style="font-size: 0.68rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">Alumnos</span>
              <div style="font-size: 1.05rem; font-weight: 900; color: #0284c7;">${ests}</div>
            </div>
            <div style="background: var(--bg-main, #f8fafc); border-radius: 8px; padding: 8px 10px; border: 1px solid var(--border, #e2e8f0);">
              <span style="font-size: 0.68rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">Catálogo</span>
              <div style="font-size: 1.05rem; font-weight: 900; color: #0f172a;">${prods} prods</div>
            </div>
            <div style="background: var(--bg-main, #f8fafc); border-radius: 8px; padding: 8px 10px; border: 1px solid var(--border, #e2e8f0);">
              <span style="font-size: 0.68rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">Órdenes</span>
              <div style="font-size: 1.05rem; font-weight: 900; color: #0284c7;">${ords}</div>
            </div>
            <div style="background: var(--bg-main, #f8fafc); border-radius: 8px; padding: 8px 10px; border: 1px solid var(--border, #e2e8f0);">
              <span style="font-size: 0.68rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">Ventas Totales</span>
              <div style="font-size: 1.05rem; font-weight: 900; color: #0f172a;">₡${ventas.toLocaleString('es-CR')}</div>
            </div>
          </div>
        </div>

        <!-- Acciones Operativas -->
        <div style="display: flex; gap: 8px; border-top: 1px solid var(--border, #e2e8f0); padding-top: 12px; justify-content: space-between; align-items: center;">
          <button onclick="verCredencialesEscuela('${escapeHtml(e.codigo)}', '${escapeHtml(e.nombre)}')" class="dev-action-btn" style="padding: 6px 12px; font-size: 0.78rem; display: inline-flex; align-items: center; gap: 5px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Cuentas
          </button>
          
          <button onclick="toggleDevEscuelaEstado(${e.id}, ${isActivo ? 0 : 1})" class="dev-action-btn ${isActivo ? '' : 'dev-action-btn-primary'}" style="padding: 6px 12px; font-size: 0.78rem; display: inline-flex; align-items: center; gap: 5px;">
            ${isActivo ? 
              `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect width="4" height="16" x="6" y="4" rx="1"/><rect width="4" height="16" x="14" y="4" rx="1"/></svg> Pausar Sede` : 
              `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg> Activar Sede`
            }
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function openModalDevEscuela() {
  const form = document.getElementById('formDevEscuela');
  if (form) form.reset();
  const modal = document.getElementById('modalDevEscuela');
  if (modal) modal.style.display = 'flex';
  setTimeout(() => document.getElementById('devEscuelaCodigo')?.focus(), 50);
}

function closeModalDevEscuela(e) {
  if (e && e.target !== e.currentTarget && !e.target.classList.contains('modal-qr-backdrop')) return;
  const modal = document.getElementById('modalDevEscuela');
  if (modal) modal.style.display = 'none';
}

function verCredencialesEscuela(codigo, nombre) {
  const cod = (codigo || '').toLowerCase();
  alert(`Credenciales para ${nombre}:\n\n` +
        `• Cajero Terminal POS:\n  Usuario: cajero_${cod}\n  Contraseña: 123456\n\n` +
        `• Administrador de Soda:\n  Usuario: admin_${cod}\n  Contraseña: 123456\n\n` +
        `Pueden ingresar directamente desde la pantalla de login principal.`);
}

async function guardarDevEscuela(e) {
  e.preventDefault();
  const btn = document.getElementById('btnDevSubmitEscuela');
  const codigo = (document.getElementById('devEscuelaCodigo')?.value || '').trim();
  const nombre = (document.getElementById('devEscuelaNombre')?.value || '').trim();
  const telefono_sinpe = (document.getElementById('devEscuelaSinpe')?.value || '').trim();
  const nombre_sinpe = (document.getElementById('devEscuelaSinpeNombre')?.value || '').trim();
  const concesionario = (document.getElementById('devEscuelaConcesionario')?.value || '').trim();

  if (!codigo || !nombre) {
    alert('El código y el nombre del centro educativo son obligatorios.');
    return;
  }

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Registrando sede...';
    }

    const res = await fetch('/api/developer/escuelas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo, nombre, telefono_sinpe, nombre_sinpe, concesionario })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al crear escuela');

    if (window.sounds) window.sounds.playCoin();

    closeModalDevEscuela();
    alert(`¡Éxito al dar de alta la escuela!\n\n` +
          `Sede: ${data.nombre} (${data.codigo})\n\n` +
          `Se creó el catálogo MEP y las siguientes cuentas operativas:\n` +
          `1. Cajero: ${data.cajero_usuario} (clave: 123456)\n` +
          `2. Admin Soda: ${data.admin_usuario} (clave: 123456)`);

    loadDevEscuelas();
  } catch (err) {
    alert('Error al registrar escuela: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Dar de Alta Escuela';
    }
  }
}

async function toggleDevEscuelaEstado(id, nuevoEstado) {
  const accion = nuevoEstado === 1 ? 'activar' : 'pausar temporalmente';
  if (!confirm(`¿Estás seguro de que deseas ${accion} esta sede escolar?`)) return;

  try {
    const res = await fetch(`/api/developer/escuelas/${id}/estado`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activo: nuevoEstado })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo cambiar el estado');

    loadDevEscuelas();
  } catch (err) {
    alert('Error actualizando estado: ' + err.message);
  }
}



