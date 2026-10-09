// RECREOPAY - LÓGICA DE CLIENTE PWA (AUTENTICACIÓN, ADMIN, ESTUDIANTES Y PADRES)

let currentUser = null;
let currentStudent = null;
let students = [];
let categories = [];
let products = [];
let activeCategoryId = null;
let menuSearchQuery = '';
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
  cargarHorariosPublicos();
  cargarConfiguracionesPublicas();

  // Registrar Service Worker para PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js?v=19.9').then(reg => {
      reg.update().catch(() => {});
      if ('Notification' in window && Notification.permission === 'granted') {
        subscribeDeviceToWebPush().catch(() => {});
      }
    }).catch(err => console.log('SW error:', err));
  }

  // Verificar si se solicitó cerrar sesión
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('logout') === 'true') {
    localStorage.removeItem('sibopay_token');
    localStorage.removeItem('sibopay_user');
    localStorage.removeItem('recreopay_token');
    localStorage.removeItem('recreopay_user');
    sessionStorage.clear();
    // Limpiar ?logout=true de la URL para que no persista en el navegador y no vuelva a cerrar sesión en F5
    try {
      if (window.history && window.history.replaceState) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } catch (e) {}
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
    try {
      await applyUserRoleSession();
    } catch (errRole) {
      console.error('Error aplicando rol de usuario en sesión:', errRole);
    }
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

  // Persistencia en caliente de datos ingresados en recarga SINPE de padres
  const inputSinpeMonto = document.getElementById('inputParentSinpeMonto');
  if (inputSinpeMonto) {
    inputSinpeMonto.addEventListener('input', (e) => {
      if (currentParentChild && typeof saveSinpeSession === 'function') {
        saveSinpeSession({ studentId: currentParentChild.id, monto: e.target.value });
      }
    });
  }

  const inputSinpeComp = document.getElementById('inputParentSinpeComprobante');
  if (inputSinpeComp) {
    inputSinpeComp.addEventListener('input', (e) => {
      if (currentParentChild && typeof saveSinpeSession === 'function') {
        saveSinpeSession({ studentId: currentParentChild.id, comprobante: e.target.value });
      }
    });
  }
});

// Atajo global para enfocar el buscador inteligente del menú al presionar '/'
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
    const searchInput = document.getElementById('menuSearchInput');
    const appContainer = document.getElementById('appContainer');
    if (searchInput && appContainer && appContainer.style.display !== 'none') {
      e.preventDefault();
      searchInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      searchInput.focus();
      searchInput.select();
    }
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

  closeLoginSheet();
  switchSheetView('login');
  closeScanChildQrModal();
  closeAdminScanQrModal();
  toggleParentPanel(false);
  closeCartModal();
  closeQrModal();
  closeTransferModal();
  cart = [];
  updateCartBar();
}

// ==========================================================================
// CONTROL DEL NUEVO DISEÑO DE LOGIN (SPLASH SCREEN & BOTTOM SHEET)
// ==========================================================================
function openLoginSheet(view = 'login') {
  const sheet = document.getElementById('loginBottomSheet');
  if (sheet) {
    sheet.classList.add('open');
    switchSheetView(view);
    setTimeout(() => {
      if (view === 'login') {
        const input = document.getElementById('loginUsername');
        if (input) input.focus();
      } else {
        const input = document.getElementById('regNombre');
        if (input) input.focus();
      }
    }, 280);
  }
}

function closeLoginSheet(e) {
  if (e && e.target && !e.target.classList.contains('bottom-sheet-backdrop') && !e.target.classList.contains('bottom-sheet-close-btn')) {
    return;
  }
  const sheet = document.getElementById('loginBottomSheet');
  if (sheet) sheet.classList.remove('open');
}

function switchSheetView(view) {
  const loginContent = document.getElementById('sheetContentLogin');
  const registerContent = document.getElementById('sheetContentRegister');
  const title = document.getElementById('bottomSheetTitle');

  if (view === 'register') {
    if (loginContent) loginContent.style.display = 'none';
    if (registerContent) registerContent.style.display = 'block';
    if (title) title.textContent = 'Registro de Padres';
  } else {
    if (loginContent) loginContent.style.display = 'block';
    if (registerContent) registerContent.style.display = 'none';
    if (title) title.textContent = 'Iniciar Sesión';
  }
}

function openTerminosModal() {
  window.open('/terminos', '_blank');
}

function closeTerminosModal() {
  // Modal eliminado: ahora redirige directamente a /terminos
}

function switchLoginTab(tab) {
  switchSheetView(tab);
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
    await showAppAlert({
      title: '¡Bienvenido(a) a SiboPay!',
      message: `Hola ${data.user.nombre}, tu cuenta de padre fue creada exitosamente.\n\nYa puedes vincular a tus hijos, asignar límites diarios y realizar recargas por SINPE Móvil de forma segura.`,
      type: 'success',
      confirmText: 'Entrar a mi Panel'
    });
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

    // Limpiar preventivamente cualquier parámetro residual de logout en la URL
    try {
      if (window.history && window.history.replaceState) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } catch (e) {}

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
  closeLoginSheet();

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

    // Si el padre tenía una sub-pantalla abierta (ej: recarga SINPE al ir al banco y volver), restaurarla exactamente
    try {
      const activeSubView = localStorage.getItem('recreopay_active_parent_subview');
      if (activeSubView === 'sinpe') {
        const activeSession = typeof getSavedSinpeSession === 'function' ? getSavedSinpeSession() : null;
        if (activeSession && activeSession.studentId) {
          const hijos = (currentUser && currentUser.hijos) ? currentUser.hijos : [];
          const matchChild = hijos.find(h => h.id === activeSession.studentId);
          if (matchChild) {
            currentParentChild = matchChild;
          }
        }
        openParentSubView('sinpe');
      }
    } catch (e) {
      console.warn('Error restaurando subvista padre:', e);
    }
  } else {
    // Estudiante: SEGURIDAD ESTRICTA - Ocultar botón de padres
    if (viewAdmin) viewAdmin.style.display = 'none';
    if (viewPadres) viewPadres.style.display = 'none';
    if (appContainer) appContainer.style.display = 'block';
    if (bottomNav) bottomNav.style.display = 'flex';
    if (navPadres) navPadres.style.display = 'none'; // Estudiantes no ven pestaña padres

    const btnPadres = document.getElementById('btnModePadres');
    if (btnPadres) btnPadres.style.display = 'none';

    // 🚀 RENDERIZADO OPTIMISTA INSTANTÁNEO (0 ms):
    // El estudiante ve su carné, saldo y botón de QR de inmediato con sus datos guardados localmente
    if (currentUser.estudiante) {
      currentStudent = currentUser.estudiante;
      currentAppMode = 'teens';
      updateStudentUI();
    }

    // En segundo plano y en paralelo: sincronizar datos frescos sin congelar la pantalla
    const studentTasks = [loadInitialData(true)];

    if (currentUser.estudiante) {
      studentTasks.push(
        fetch(`/api/estudiantes/${currentUser.estudiante.id}`)
          .then(r => r.json())
          .then(freshStudent => {
            if (freshStudent && freshStudent.id) {
              currentStudent = freshStudent;
              currentUser.estudiante = freshStudent;
              try {
                localStorage.setItem('sibopay_user', JSON.stringify(currentUser));
              } catch (_) {}
              updateStudentUI();
            }
          })
          .catch(e => console.warn('Error sincronizando estudiante:', e))
      );
    } else if (students.length > 0) {
      selectStudent(students[0].id);
    }

    await Promise.allSettled(studentTasks);
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
    cargarBackupsDev();
  } else if (tab === 'escuelas') {
    const btn = document.getElementById('btnDevTabEscuelas');
    const content = document.getElementById('devTabContentEscuelas');
    if (btn) btn.classList.add('active');
    if (content) content.style.display = 'block';
    loadDevEscuelas();
  } else if (tab === 'importacion') {
    const btn = document.getElementById('btnDevTabImportacion');
    const content = document.getElementById('devTabContentImportacion');
    if (btn) btn.classList.add('active');
    if (content) content.style.display = 'block';
    cargarEscuelasSelectImportacion();
  } else if (tab === 'sinpe') {
    const btn = document.getElementById('btnDevTabSinpe');
    const content = document.getElementById('devTabContentSinpe');
    if (btn) btn.classList.add('active');
    if (content) content.style.display = 'block';
    loadDevSinpeUniversal();
  } else if (tab === 'kardex') {
    const btn = document.getElementById('btnDevTabKardex');
    const content = document.getElementById('devTabContentKardex');
    if (btn) btn.classList.add('active');
    if (content) content.style.display = 'block';
    inicializarDevKardex();
  } else if (tab === 'logs') {
    const btn = document.getElementById('btnDevTabLogs');
    const content = document.getElementById('devTabContentLogs');
    if (btn) btn.classList.add('active');
    if (content) content.style.display = 'block';
    initDevLogsTerminal();
  } else if (tab === 'reglas') {
    const btn = document.getElementById('btnDevTabReglas');
    const content = document.getElementById('devTabContentReglas');
    if (btn) btn.classList.add('active');
    if (content) content.style.display = 'block';
    cargarReglasNegocioDev();
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
    localStorage.removeItem('recreopay_active_parent_subview');
    if (typeof clearSinpeSession === 'function') clearSinpeSession();
    currentUser = null;
    currentStudent = null;
    currentParentChild = null;
    adminSelectedStudent = null;
    try {
      if (window.history && window.history.replaceState) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } catch (e) {}
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
  } else if (target === 'ajustes') {
    const btn = document.getElementById('pwaNavAjustes');
    if (btn) btn.classList.add('active');
    abrirModalAjustesCuenta();
  }
}

async function loadInitialData(isStudent = false) {
  try {
    const escId = (currentUser && currentUser.escuela_id) || (currentStudent && currentStudent.escuela_id) || 1;

    // 🚀 Ejecución paralela ultra rápida con Promise.all
    const promises = [
      fetch(`/api/productos?escuela_id=${escId}`).then(r => r.json()).catch(() => ({ categorias: [], productos: [] })),
      loadCardDesigns()
    ];

    if (!isStudent) {
      promises.push(fetch('/api/estudiantes').then(r => r.json()).catch(() => []));
    }

    const [dataProd, _, resEst] = await Promise.all(promises);

    if (dataProd) {
      categories = dataProd.categorias || [];
      const seenNames = new Set();
      products = (dataProd.productos || []).filter(p => {
        const key = String(p.nombre).trim().toLowerCase();
        if (seenNames.has(key)) return false;
        seenNames.add(key);
        return true;
      });
      renderCategories();
      renderProducts();
    }

    if (!isStudent && Array.isArray(resEst)) {
      students = resEst;
      populateStudentSelector();
    }
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
  document.getElementById('walletGrade').textContent = `${currentStudent.grado} • Sección ${currentStudent.seccion}`;
  const codeEl = document.getElementById('walletStudentCode');
  if (codeEl) {
    codeEl.textContent = `Cód: ${currentStudent.codigo_estudiante || ''}`;
  } else {
    document.getElementById('walletGrade').textContent = `${currentStudent.grado} • Sección ${currentStudent.seccion} • Cód: ${currentStudent.codigo_estudiante}`;
  }
  
  // Aplicar tema personalizado de tarjeta
  if (typeof applyCardTheme === 'function' && typeof getSavedCardTheme === 'function') {
    applyCardTheme(getSavedCardTheme());
  }

  // Saldo total, retenido y disponible para gastar
  const saldoTotal = (typeof currentStudent.saldo_total === 'number') 
    ? currentStudent.saldo_total 
    : (currentStudent.saldo_colones || 0);
  const saldoRetenido = currentStudent.saldo_retenido || 0;
  const saldoDisponible = (typeof currentStudent.saldo_disponible === 'number')
    ? currentStudent.saldo_disponible
    : Math.max(0, saldoTotal - saldoRetenido);

  document.getElementById('walletBalance').textContent = `₡${saldoDisponible.toLocaleString('es-CR')}`;
  document.getElementById('balanceLabel').textContent = saldoRetenido > 0 ? 'DISPONIBLE PARA GASTAR' : 'SALDO DISPONIBLE';
  
  // Desglose transparente cuando hay monto retenido en pre-órdenes
  const breakdownBox = document.getElementById('breakdownSaldoBox');
  if (breakdownBox) {
    if (saldoRetenido > 0) {
      breakdownBox.style.display = 'block';
      const lblTot = document.getElementById('lblSaldoTotalBreakdown');
      if (lblTot) lblTot.textContent = `₡${saldoTotal.toLocaleString('es-CR')}`;
      const lblRet = document.getElementById('lblSaldoRetenidoBreakdown');
      if (lblRet) lblRet.textContent = `₡${saldoRetenido.toLocaleString('es-CR')}`;
    } else {
      breakdownBox.style.display = 'none';
    }
  }

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
    : Math.max(0, limiteDiario - gastadoHoy - saldoRetenido);

  document.getElementById('dailyLimitText').textContent = `₡${limiteDiario.toLocaleString('es-CR')}`;
  document.getElementById('dailyAvailableText').textContent = `Disponible hoy: ₡${disponibleHoy.toLocaleString('es-CR')}`;

  const tienePreordenes = Boolean(currentStudent.tiene_preordenes_pendientes || (currentStudent.preordenes_pendientes_count > 0));
  const qrBloqueadoPorLimite = disponibleHoy <= 0 && !tienePreordenes;

  // Banner informativo si alcanzó su límite diario
  const bannerLimitBlocked = document.getElementById('bannerQrDailyLimitBlocked');
  if (bannerLimitBlocked) {
    if (disponibleHoy <= 0) {
      bannerLimitBlocked.style.display = 'flex';
      const msgEl = document.getElementById('bannerQrDailyLimitMsg');
      if (msgEl) {
        msgEl.textContent = tienePreordenes
          ? 'Has alcanzado tu límite diario de consumo. Tu código QR solo podrá ser escaneado en la soda para retirar tu Pre-Orden.'
          : `Has alcanzado tu límite diario de ₡${limiteDiario.toLocaleString('es-CR')} asignado por tus padres. La generación del código QR para compras está bloqueada hasta mañana.`;
      }
    } else {
      bannerLimitBlocked.style.display = 'none';
    }
  }

  // Alerta de Tarjeta Bloqueada
  const bannerBlocked = document.getElementById('bannerCardBlocked');
  if (bannerBlocked) {
    bannerBlocked.style.display = currentStudent.tarjeta_bloqueada ? 'flex' : 'none';
  }
  document.querySelectorAll('.qr-toggle-btn').forEach(btn => {
    if (currentStudent.tarjeta_bloqueada) {
      btn.style.opacity = '0.45';
      btn.style.pointerEvents = 'none';
    } else if (qrBloqueadoPorLimite) {
      btn.style.opacity = '0.55';
      btn.style.filter = 'grayscale(0.85)';
      btn.title = 'Límite diario alcanzado: no puedes generar QR para compras';
      btn.style.pointerEvents = 'auto'; // Permitir clic para mostrar el mensaje explicativo
    } else {
      btn.style.opacity = '1';
      btn.style.filter = 'none';
      btn.style.pointerEvents = 'auto';
    }
  });

  const pwaNavQr = document.getElementById('pwaNavQr');
  if (pwaNavQr) {
    if (qrBloqueadoPorLimite) {
      pwaNavQr.style.opacity = '0.55';
      pwaNavQr.title = 'Límite diario alcanzado';
    } else {
      pwaNavQr.style.opacity = '1';
      pwaNavQr.title = '';
    }
  }

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
  updateQrSecurityBadgeUI();

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
  loadStudentActiveOrders();
}

// Modal de confirmación defensivo con soporte para showAppConfirm
async function appConfirmPrompt(title, message, confirmText = 'Sí, Cancelar') {
  if (typeof window.showAppConfirm === 'function') {
    return await window.showAppConfirm({
      title,
      message,
      confirmText,
      cancelText: 'Volver',
      danger: true
    });
  }
  return window.confirm(`${title}\n\n${message}`);
}

/**
 * Carga y renderiza los pedidos activos del estudiante actual
 */
async function loadStudentActiveOrders() {
  const container = document.getElementById('studentActiveOrdersSection');
  const list = document.getElementById('studentActiveOrdersList');
  const countBadge = document.getElementById('studentActiveOrdersCountBadge');
  if (!container || !list) return;

  if (!currentStudent || !currentStudent.id) {
    container.style.display = 'none';
    return;
  }

  try {
    const res = await fetch(`/api/ordenes?estudiante_id=${currentStudent.id}&estado=activos`);
    if (!res.ok) throw new Error('Error al consultar pedidos activos');
    const ordenes = await res.json();

    if (!Array.isArray(ordenes) || ordenes.length === 0) {
      container.style.display = 'none';
      list.innerHTML = '';
      return;
    }

    container.style.display = 'block';
    if (countBadge) {
      countBadge.textContent = `${ordenes.length} activo${ordenes.length === 1 ? '' : 's'}`;
    }

    list.innerHTML = ordenes.map(o => {
      const itemsStr = (o.items && o.items.length > 0)
        ? o.items.map(it => `${it.cantidad}x ${it.nombre}`).join(', ')
        : 'Pre-orden escolar';
      const badge = getMomentoBadge(o.momento_entrega);
      const codigo = o.codigo_orden || `ORD-${o.id}`;

      let estadoLabel = '⏳ Pendiente en cocina';
      let estadoColor = '#f59e0b';
      if (o.estado === 'en_preparacion') {
        estadoLabel = '👨‍🍳 En preparación';
        estadoColor = '#0284c7';
      } else if (o.estado === 'listo') {
        estadoLabel = '✅ Listo para retirar';
        estadoColor = '#10b981';
      }

      return `
        <div class="active-order-card">
          <div class="active-order-header">
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              <strong style="font-size: 0.85rem; color: var(--text-main);">${codigo}</strong>
              <span style="background: ${badge.badgeBg}; color: ${badge.badgeColor}; border: 1px solid ${badge.badgeBorder}; padding: 1px 7px; border-radius: 6px; font-weight: 800; font-size: 0.7rem;">
                ${badge.icon} ${badge.title}
              </span>
              <span style="font-size: 0.72rem; color: ${estadoColor}; font-weight: 800;">
                ${estadoLabel}
              </span>
            </div>
          </div>
          <div class="active-order-items">${itemsStr}</div>
          <div class="active-order-footer">
            <span style="font-size: 0.82rem; font-weight: 800; color: #0284c7;">
              Total: ₡${(o.total_colones || 0).toLocaleString('es-CR')} <small style="font-size: 0.68rem; color: var(--text-muted); font-weight: 600;">(Retenido)</small>
            </span>
            <button type="button" class="btn-cancel-order-action" onclick="cancelarOrdenEstudiante(${o.id}, '${codigo}', ${o.total_colones || 0})">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              <span>Cancelar Pedido</span>
            </button>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.warn('Error en loadStudentActiveOrders:', err);
    container.style.display = 'none';
  }
}

/**
 * Permite al estudiante cancelar su pedido activo y liberar saldo de inmediato
 */
async function cancelarOrdenEstudiante(ordenId, codigoOrden, monto) {
  const montoFmt = `₡${(monto || 0).toLocaleString('es-CR')}`;
  const ok = await appConfirmPrompt(
    '¿Cancelar Pedido?',
    `¿Deseas cancelar tu pedido ${codigoOrden} de ${montoFmt}? Tu dinero retenido volverá a estar disponible de inmediato para realizar otra compra.`,
    'Sí, Cancelar Pedido'
  );
  if (!ok) return;

  try {
    const res = await fetch(`/api/ordenes/${ordenId}/cancelar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usuario_rol: 'estudiante',
        estudiante_id: currentStudent ? currentStudent.id : undefined,
        motivo: 'Cancelada por el estudiante desde la app'
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al cancelar el pedido');

    if (window.sounds) window.sounds.playCoin();
    await showAppAlert({
      title: '¡Pedido Cancelado!',
      message: `Tu pedido ${codigoOrden} fue cancelado exitosamente. Tus ${montoFmt} ya están disponibles en tu saldo.`,
      type: 'success'
    });

    if (currentStudent && currentStudent.id) {
      const freshRes = await fetch(`/api/estudiantes/${currentStudent.id}`);
      if (freshRes.ok) {
        currentStudent = await freshRes.json();
        updateStudentUI();
        triggerBalancePulse();
      }
      await loadStudentActiveOrders();
    }
  } catch (err) {
    await showAppAlert({
      title: 'Error',
      message: `No se pudo cancelar el pedido: ${err.message}`,
      type: 'error'
    });
  }
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
    const iconBadge = window.SiboPayIcons 
      ? window.SiboPayIcons.getFoodIconBadge(cat.icono, cat.nombre, 'inline')
      : `<span>${cat.icono || '🍽️'}</span>`;
    html += `
      <button class="cat-pill ${activeCategoryId === cat.id ? 'active' : ''}" onclick="selectCategory(${cat.id})" style="display: inline-flex; align-items: center; gap: 6px;">
        ${iconBadge} <span>${cat.nombre}</span>
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

// ==========================================
// BUSCADOR INTELIGENTE DEL MENÚ (ESTUDIANTES, NIÑOS Y PADRES)
// ==========================================

function normalizeSearchStr(s) {
  if (!s) return '';
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function matchesMenuProduct(prod, query) {
  if (!query) return true;
  const cleanQ = normalizeSearchStr(query);
  if (!cleanQ) return true;

  // 1. Operadores de precio (ej: <1000, <=1200, >500, >=800 o "< 1000")
  const priceOpMatch = cleanQ.replace(/\s+/g, '').match(/^([<>]=?)(\d+)$/);
  if (priceOpMatch) {
    const op = priceOpMatch[1];
    const val = parseInt(priceOpMatch[2], 10);
    const price = Number(prod.precio_colones) || 0;
    if (op === '<') return price < val;
    if (op === '<=') return price <= val;
    if (op === '>') return price > val;
    if (op === '>=') return price >= val;
  }

  // 2. Filtros especiales por palabras clave inteligentes
  if (cleanQ === 'saludable' || cleanQ === 'saludables' || cleanQ === 'nutritivo') {
    return Boolean(prod.cumple_mep || prod.es_saludable || /fruta|avena|ensalada|natural/i.test((prod.nombre || '') + ' ' + (prod.descripcion || '')));
  }
  if (cleanQ === 'bloqueado' || cleanQ === 'agotado' || cleanQ === 'sin stock') {
    return Boolean(prod.disponible === 0 || (prod.control_stock === 1 && prod.stock <= 0));
  }
  if (cleanQ === 'disponible' || cleanQ === 'en stock') {
    return Boolean(prod.disponible === 1 && (!prod.control_stock || prod.stock > 0));
  }
  if (cleanQ === 'fresco' || cleanQ === 'frescos' || cleanQ === 'bebida' || cleanQ === 'bebidas' || cleanQ === 'jugo' || cleanQ === 'jugos' || cleanQ === 'batido') {
    const catName = normalizeSearchStr(prod.categoria_nombre || '');
    if (catName.includes('bebida') || catName.includes('fresco') || prod.categoria_id === 3) return true;
  }
  if (cleanQ === 'desayuno' || cleanQ === 'desayunos' || cleanQ === 'merienda' || cleanQ === 'meriendas') {
    if (prod.categoria_id === 1) return true;
  }
  if (cleanQ === 'almuerzo' || cleanQ === 'almuerzos' || cleanQ === 'plato' || cleanQ === 'platos' || cleanQ === 'comida') {
    if (prod.categoria_id === 2) return true;
  }
  if (cleanQ === 'snack' || cleanQ === 'snacks' || cleanQ === 'galleta' || cleanQ === 'galletas' || cleanQ === 'postre') {
    if (prod.categoria_id === 4) return true;
  }

  // 3. Coincidencia por precio numérico exacto o parcial (ej: 750, 1000)
  if (/^\d+$/.test(cleanQ)) {
    const pStr = String(prod.precio_colones || '');
    if (pStr === cleanQ || pStr.includes(cleanQ)) return true;
  }

  // 4. Búsqueda multi-término inteligente (nombre, categoría, descripción, alergenos, precio)
  const tokens = cleanQ.split(/\s+/).filter(Boolean);
  const targetStr = normalizeSearchStr(
    `${prod.nombre || ''} ${prod.categoria_nombre || ''} ${prod.descripcion || ''} ${prod.alergenos || ''} ${prod.precio_colones || ''}`
  );

  return tokens.every(token => targetStr.includes(token));
}

function handleMenuSearchInput(val) {
  menuSearchQuery = val || '';
  const clearBtn = document.getElementById('menuSearchClearBtn');
  if (clearBtn) {
    clearBtn.style.display = menuSearchQuery.trim() ? 'inline-flex' : 'none';
  }
  renderProducts();
}

function clearMenuSearch() {
  menuSearchQuery = '';
  const input = document.getElementById('menuSearchInput');
  if (input) {
    input.value = '';
    input.focus();
  }
  const clearBtn = document.getElementById('menuSearchClearBtn');
  if (clearBtn) clearBtn.style.display = 'none';

  // Desactivar chips de búsqueda
  document.querySelectorAll('.search-chip').forEach(c => c.classList.remove('active'));

  renderProducts();
}

function setMenuSearchSuggestion(term) {
  // Al seleccionar sugerencia rápida, si el usuario busca algo general, aseguramos buscar en todo
  if (['fresco', 'casado', 'empanada', '<1000', 'saludable'].includes(term)) {
    activeCategoryId = null;
    renderCategories();
  }
  const input = document.getElementById('menuSearchInput');
  if (input) {
    input.value = term;
    handleMenuSearchInput(term);
    input.focus();
  }
  document.querySelectorAll('.search-chip').forEach(chip => {
    if (chip.getAttribute('onclick')?.includes(`'${term}'`)) {
      chip.classList.add('active');
    } else {
      chip.classList.remove('active');
    }
  });
}

function handleMenuSearchKeyDown(e) {
  if (e.key === 'Escape') {
    clearMenuSearch();
  }
}

function searchMenuFromParent(val) {
  switchToSodaMenuAsParent();
  setTimeout(() => {
    const searchInput = document.getElementById('menuSearchInput');
    if (searchInput) {
      searchInput.value = val || '';
      handleMenuSearchInput(val || '');
      searchInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      searchInput.focus();
    }
  }, 200);
}

// Renderizado de Productos del Menú (Con soporte para Agotado / Greyed Out y Buscador Inteligente)
function renderProducts() {
  const grid = document.getElementById('productsGrid');
  if (!grid) return;
  const filterMepOnly = document.getElementById('chkFilterMep')?.checked || false;

  let filtered = products;

  // Filtrado por categoría si no es "Todos"
  if (activeCategoryId !== null) {
    filtered = filtered.filter(p => p.categoria_id === activeCategoryId);
  }

  if (filterMepOnly) {
    filtered = filtered.filter(p => p.cumple_mep === 1);
  }

  // APLICACIÓN DEL BUSCADOR INTELIGENTE MULTI-TÉRMINO
  const hasSearch = Boolean(menuSearchQuery && menuSearchQuery.trim());
  if (hasSearch) {
    filtered = filtered.filter(p => matchesMenuProduct(p, menuSearchQuery));
  }

  // Actualización de encabezado y estadísticas de resultados
  const statsEl = document.getElementById('menuSearchStats');
  const statsText = document.getElementById('menuSearchStatsText');
  const catalogTitle = document.getElementById('catalogTitle');

  if (statsEl && statsText) {
    if (hasSearch) {
      statsEl.style.display = 'flex';
      const cleanTerm = menuSearchQuery.trim();
      statsText.innerHTML = `Mostrando <strong>${filtered.length}</strong> de ${products.length} productos para "<strong>${escapeHtml(cleanTerm)}</strong>"`;
      if (catalogTitle) {
        catalogTitle.textContent = `Resultados de búsqueda (${filtered.length})`;
      }
    } else {
      statsEl.style.display = 'none';
      if (catalogTitle) {
        if (activeCategoryId !== null) {
          const currentCat = categories.find(c => c.id === activeCategoryId);
          catalogTitle.textContent = currentCat ? currentCat.nombre : 'Menú del Recreo';
        } else {
          catalogTitle.textContent = 'Menú del Recreo';
        }
      }
    }
  }

  // Estado vacío: Sin resultados
  if (filtered.length === 0) {
    if (hasSearch) {
      grid.innerHTML = `
        <div class="menu-smart-search-empty">
          <div class="menu-smart-search-empty-icon">🔍</div>
          <h4>No encontramos productos</h4>
          <p>No hay platillos o bebidas que coincidan con "<strong>${escapeHtml(menuSearchQuery.trim())}</strong>".</p>
          <div class="menu-smart-search-suggestions">
            <button type="button" class="search-chip" onclick="setMenuSearchSuggestion('fresco')">🥤 Frescos naturales</button>
            <button type="button" class="search-chip" onclick="setMenuSearchSuggestion('casado')">🍛 Casados</button>
            <button type="button" class="search-chip" onclick="setMenuSearchSuggestion('empanada')">🥟 Empanadas</button>
            <button type="button" class="search-chip" onclick="setMenuSearchSuggestion('<1000')">💰 Menos de ₡1.000</button>
          </div>
          <button type="button" class="btn-saas btn-saas-outline" onclick="clearMenuSearch()" style="margin-top: 8px;">
            Ver catálogo completo
          </button>
        </div>
      `;
    } else {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 30px; color: var(--text-muted);">
          <div style="display: flex; justify-content: center; margin-bottom: 8px;"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity: 0.4;"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg></div>
          <p>No hay productos en esta categoría por ahora.</p>
        </div>
      `;
    }
    return;
  }

  grid.innerHTML = filtered.map(prod => {
    const isOutOfStock = prod.disponible === 0 || (prod.control_stock === 1 && prod.stock <= 0);
    const stockBadge = isOutOfStock
      ? '<span class="badge-out-of-stock">AGOTADO</span>'
      : '';

    const iconHtml = window.SiboPayIcons 
      ? window.SiboPayIcons.getFoodIconBadge(prod.icono, prod.nombre, 'card') 
      : `<div class="product-icon-wrap">${prod.icono || '🥪'}</div>`;

    const hasAlergenos = prod.alergenos && 
      !['ninguno', 'ninguno conocido', 'no', 'ninguno.', 'sin alérgenos', 'sin alergenos', 'n/a'].includes(String(prod.alergenos).trim().toLowerCase());

    const mediaHtml = prod.imagen_url 
      ? `<div style="width: 100%; height: 130px; border-radius: 12px; overflow: hidden; margin-bottom: 10px; background: #f8fafc; border: 1px solid var(--border, #e2e8f0); position: relative; box-shadow: 0 2px 6px rgba(0,0,0,0.03); display: flex; align-items: center; justify-content: center;">
           <img src="${prod.imagen_url}" alt="${prod.nombre}" style="width: 100%; height: 100%; object-fit: cover; display: block;" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';">
           <div style="display: none; width: 100%; height: 100%; align-items: center; justify-content: center;">
             ${iconHtml}
           </div>
         </div>`
      : `<div style="display: flex; justify-content: center; align-items: center; margin-bottom: 8px;">${iconHtml}</div>`;

    return `
      <div class="product-card ${isOutOfStock ? 'out-of-stock' : ''}">
        ${mediaHtml}
        <div>
          ${stockBadge ? `<div style="display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 4px;">${stockBadge}</div>` : ''}
          <h4 class="product-name">${prod.nombre}</h4>
          <p class="product-desc">${prod.descripcion || ''}</p>
          ${hasAlergenos ? `<div style="font-size: 0.68rem; color: #dc2626; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Contiene: ${prod.alergenos}</div>` : ''}
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
  if (!bar) return;
  const countBadge = document.getElementById('cartCountBadge');
  const totalText = document.getElementById('cartTotalText');

  const totalCount = (cart || []).reduce((sum, item) => sum + (item.cantidad || 1), 0);
  const totalColones = (cart || []).reduce((sum, item) => sum + (item.product.precio_colones * (item.cantidad || 1)), 0);

  // Sincronizar badge de la cabecera en el portal de padres si existe
  const parentBadge = document.getElementById('parentCartBadgeCount');
  if (parentBadge) {
    parentBadge.textContent = totalCount;
  }

  // Verificar si estamos en vista de estudiante o de padres
  const appContainer = document.getElementById('appContainer');
  const viewPadres = document.getElementById('viewPadres');
  const isStudentView = appContainer && appContainer.style.display !== 'none';
  const isParentView = viewPadres && viewPadres.style.display !== 'none';

  if (totalCount > 0 && (isStudentView || isParentView)) {
    bar.style.display = 'flex';
    if (countBadge) countBadge.textContent = `${totalCount} ${totalCount === 1 ? 'ítem' : 'ítems'}`;
    if (totalText) totalText.textContent = `₡${totalColones.toLocaleString('es-CR')}`;

    // Efecto de pulso reactivo en el botón y barra flotante al agregar items
    bar.classList.remove('cart-bump');
    void bar.offsetWidth; // re-flow
    bar.classList.add('cart-bump');
  } else {
    bar.style.display = 'none';
  }
}

function openCartModal() {
  renderCartModalItems();

  const studentNameEl = document.getElementById('modalCartStudentName');
  if (studentNameEl) {
    if (currentUser && currentUser.rol === 'padre' && currentParentChild) {
      studentNameEl.textContent = `Pre-orden para: ${currentParentChild.nombre_completo}`;
      studentNameEl.style.display = 'block';
    } else {
      studentNameEl.style.display = 'none';
    }
  }

  const modal = document.getElementById('modalCart');
  if (modal) modal.style.display = 'flex';
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
    const itemBadge = window.SiboPayIcons
      ? window.SiboPayIcons.getFoodIconBadge(item.product.icono, item.product.nombre, 'badge')
      : '';
    return `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #f1f5f9;">
        <div style="display: flex; align-items: center; gap: 8px;">
          ${itemBadge}
          <div>
            <strong style="font-size: 0.9rem; color: #0f172a;">${item.product.nombre}</strong>
            <div style="font-size: 0.75rem; color: #64748b;">₡${item.product.precio_colones.toLocaleString('es-CR')} c/u</div>
          </div>
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

function normalizeMomentoKey(val) {
  if (!val) return 'recreo_1';
  const v = String(val).toLowerCase().trim();
  if (v === 'recreo_1' || v.includes('1er') || v.includes('9:30')) return 'recreo_1';
  if (v === 'almuerzo' || v.includes('almuerzo') || v.includes('11:45')) return 'almuerzo';
  if (v === 'recreo_2' || v.includes('2do') || v.includes('1:45')) return 'recreo_2';
  if (v === 'inmediato' || v.includes('inmediato')) return 'inmediato';
  return v;
}

let currentSchoolHorarios = {
  hora_recreo_1_fmt: '9:30 AM',
  hora_almuerzo_fmt: '11:45 AM',
  hora_recreo_2_fmt: '1:45 PM'
};

async function cargarHorariosPublicos(forcedEscuelaId) {
  try {
    const escId = forcedEscuelaId || (currentUser && currentUser.escuela_id) || (currentStudent && currentStudent.escuela_id) || 1;
    const res = await fetch(`/api/escuela/horarios?escuela_id=${escId}`);
    const data = await res.json();
    if (data && data.horarios) {
      currentSchoolHorarios = data.horarios;
      window.schoolHorarios = data.horarios;
      actualizarTextosHorariosPreordenes();
    }
  } catch (e) {
    console.warn('Error cargando horarios escolares:', e);
  }
}

function actualizarTextosHorariosPreordenes() {
  const h = window.schoolHorarios || currentSchoolHorarios || {};
  const r1Text = h.hora_recreo_1_fmt || '9:30 AM';
  const almText = h.hora_almuerzo_fmt || '11:45 AM';
  const r2Text = h.hora_recreo_2_fmt || '1:45 PM';

  const select = document.getElementById('momentoEntregaSelect');
  if (select) {
    const prev = select.value;
    select.innerHTML = `
      <option value="recreo_1">🔔 1er Recreo de la Mañana (${r1Text})</option>
      <option value="almuerzo">🍲 Hora de Almuerzo (${almText})</option>
      <option value="recreo_2">⏰ 2do Recreo de la Tarde (${r2Text})</option>
    `;
    if (prev) select.value = prev;
  }
}

function getMomentoBadge(val) {
  const key = normalizeMomentoKey(val);
  const h = window.schoolHorarios || currentSchoolHorarios || {};
  const r1Text = h.hora_recreo_1_fmt || '9:30 AM';
  const almText = h.hora_almuerzo_fmt || '11:45 AM';
  const r2Text = h.hora_recreo_2_fmt || '1:45 PM';

  switch (key) {
    case 'recreo_1':
      return {
        key: 'recreo_1',
        title: `1er Recreo (${r1Text})`,
        full: `1er Recreo de la Mañana (${r1Text})`,
        icon: '🔔',
        bg: '#fffbeb',
        border: '#f59e0b',
        text: '#b45309',
        badgeBg: '#fef3c7',
        badgeColor: '#92400e',
        badgeBorder: '#fde68a'
      };
    case 'almuerzo':
      return {
        key: 'almuerzo',
        title: `Almuerzo (${almText})`,
        full: `Hora de Almuerzo (${almText})`,
        icon: '🍲',
        bg: '#f0fdf4',
        border: '#16a34a',
        text: '#15803d',
        badgeBg: '#dcfce7',
        badgeColor: '#166534',
        badgeBorder: '#86efac'
      };
    case 'recreo_2':
      return {
        key: 'recreo_2',
        title: `2do Recreo (${r2Text})`,
        full: `2do Recreo de la Tarde (${r2Text})`,
        icon: '⏰',
        bg: '#eef2ff',
        border: '#6366f1',
        text: '#4338ca',
        badgeBg: '#e0e7ff',
        badgeColor: '#3730a3',
        badgeBorder: '#c7d2fe'
      };
    case 'inmediato':
      return {
        key: 'inmediato',
        title: 'Entrega Inmediata',
        full: 'Entrega Inmediata en Mostrador',
        icon: '⚡',
        bg: '#f8fafc',
        border: '#64748b',
        text: '#334155',
        badgeBg: '#f1f5f9',
        badgeColor: '#334155',
        badgeBorder: '#cbd5e1'
      };
    default:
      return {
        key: val || 'otro',
        title: val || 'Pre-orden',
        full: val || 'Pre-orden de recreo',
        icon: '🥪',
        bg: '#f8fafc',
        border: '#0284c7',
        text: '#0369a1',
        badgeBg: '#e0e7fe',
        badgeColor: '#0369a1',
        badgeBorder: '#bae6fd'
      };
  }
}

async function submitPreOrder() {
  const targetStudent = (currentUser && currentUser.rol === 'padre' && currentParentChild) ? currentParentChild : currentStudent;
  if (!targetStudent) return;
  if (cart.length === 0) return alert('Agrega al menos un producto a tu pre-orden');

  const momentoSelect = document.getElementById('momentoEntregaSelect');
  const momento = momentoSelect ? momentoSelect.value : 'recreo_1';
  const momentoBadge = getMomentoBadge(momento);

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
        estudiante_id: targetStudent.id,
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

    alert(`¡Pre-Orden confirmada con éxito!\n\n📋 Código de retiro: ${data.codigo_orden}\n⏰ Horario: ${momentoBadge.full}\n🔒 Monto reservado (flotante): ₡${data.total_colones.toLocaleString('es-CR')}\n\nNota: Este saldo queda retenido y se rebajará formalmente en la soda al retirar tu pedido presentando tu carné QR.`);

    // Limpiar carrito y recargar datos del estudiante o padre
    cart = [];
    updateCartBar();
    const cartBadge = document.getElementById('parentCartBadgeCount');
    if (cartBadge) cartBadge.textContent = '0';
    closeCartModal();

    if (currentUser && currentUser.rol === 'padre') {
      await loadParentDashboard();
      if (currentParentChild) {
        await loadActiveChildHistory(currentParentChild.id);
        await loadParentActiveOrders(currentParentChild.id);
      }
    } else if (currentStudent) {
      await selectStudent(currentStudent.id);
      await loadStudentActiveOrders();
    }
  } catch (err) {
    alert(`No se pudo procesar: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> <span>Confirmar Pre-Orden (Monto Flotante)</span>';
  }
}

// ==========================================
// MODAL QR ESCOLAR Y SEGURIDAD BIOMÉTRICA / PIN
// ==========================================

function openQrModal() {
  if (currentStudent) {
    const limiteDiario = currentStudent.limite_diario_colones || 0;
    const gastadoHoy = currentStudent.gastado_hoy || 0;
    const saldoRetenido = currentStudent.saldo_retenido || 0;
    const disponibleHoy = (typeof currentStudent.disponible_hoy === 'number')
      ? currentStudent.disponible_hoy
      : Math.max(0, limiteDiario - gastadoHoy - saldoRetenido);

    const tienePreordenes = Boolean(currentStudent.tiene_preordenes_pendientes || (currentStudent.preordenes_pendientes_count > 0));

    // Si superó su límite diario y NO tiene pre-órdenes pendientes, bloquear apertura
    if (disponibleHoy <= 0 && !tienePreordenes) {
      if (window.sounds) window.sounds.playError();
      alert(`⛔ Límite Diario Alcanzado\n\nHas consumido tu límite máximo diario de ₡${limiteDiario.toLocaleString('es-CR')} establecido por tus padres.\n\nNo es posible generar códigos QR para nuevas compras hasta la siguiente jornada escolar.`);
      resetPwaNavActive();
      return;
    }

    // Si tiene pre-órdenes pendientes pero agotó el límite diario de mostrador, mostrar aviso informativo
    const preBanner = document.getElementById('qrPreorderOnlyBanner');
    if (preBanner) {
      preBanner.style.display = (disponibleHoy <= 0 && tienePreordenes) ? 'block' : 'none';
    }
  }

  // Si la protección biométrica o PIN está activa, autenticar primero
  if (isQrSecurityActiveForCurrentStudent()) {
    triggerQrSecurityUnlock(() => {
      showQrModalActual();
    });
    return;
  }

  showQrModalActual();
}

function showQrModalActual() {
  if (window.sounds) window.sounds.playScanChirp();
  document.getElementById('modalQr').style.display = 'flex';
}

// --------------------------------------------------------------------------
// MÓDULO DE AUTENTICACIÓN BIOMÉTRICA (FACE ID / HUELLA / PIN)
// --------------------------------------------------------------------------
let pendingQrUnlockSuccessCallback = null;

function getActiveStudentForQrSecurity() {
  return currentStudent || currentParentChild || null;
}

function getQrSecurityKey() {
  const active = getActiveStudentForQrSecurity();
  const estId = active ? (active.id || active.codigo_estudiante || 'default') : 'default';
  return 'sibopay_qr_security_' + estId;
}

function isQrSecurityActiveForCurrentStudent() {
  const active = getActiveStudentForQrSecurity();
  if (active && active.bloqueo_qr_biometrico !== undefined && active.bloqueo_qr_biometrico !== null) {
    const isAct = (Number(active.bloqueo_qr_biometrico) === 1 || active.bloqueo_qr_biometrico === true || active.bloqueo_qr_biometrico === '1');
    const key = getQrSecurityKey();
    localStorage.setItem(key, isAct ? 'true' : 'false');
    return isAct;
  }
  const key = getQrSecurityKey();
  return localStorage.getItem(key) === 'true';
}

function applyRealtimeQrSecurity(estId, isBlocked) {
  const isEnabled = Number(isBlocked) === 1 || isBlocked === true || isBlocked === '1';
  const key = 'sibopay_qr_security_' + estId;
  localStorage.setItem(key, isEnabled ? 'true' : 'false');

  if (currentStudent && Number(currentStudent.id) === Number(estId)) {
    currentStudent.bloqueo_qr_biometrico = isEnabled ? 1 : 0;
    updateQrSecurityBadgeUI();
  }

  if (currentParentChild && Number(currentParentChild.id) === Number(estId)) {
    currentParentChild.bloqueo_qr_biometrico = isEnabled ? 1 : 0;
    updateParentQrSecurityCardUI();
  }

  if (currentUser && currentUser.estudiante && Number(currentUser.estudiante.id) === Number(estId)) {
    currentUser.estudiante.bloqueo_qr_biometrico = isEnabled ? 1 : 0;
  }

  // Si el modal de PIN estaba abierto en el estudiante y se desactiva en tiempo real, cerrarlo
  if (!isEnabled) {
    const pinModal = document.getElementById('modalQrPinPrompt');
    if (pinModal && pinModal.style.display !== 'none') {
      pinModal.style.display = 'none';
      if (typeof pendingQrUnlockSuccessCallback === 'function') {
        pendingQrUnlockSuccessCallback();
        pendingQrUnlockSuccessCallback = null;
      }
    }
  }
}

function getQrSecurityPin() {
  const active = getActiveStudentForQrSecurity();
  const estId = active ? (active.id || active.codigo_estudiante || 'default') : 'default';
  const customPin = localStorage.getItem('sibopay_qr_pin_' + estId);
  if (customPin) return customPin;
  if (active && active.pin_seguridad) return String(active.pin_seguridad);
  return '1234';
}

async function checkDeviceBiometricsSupport() {
  if (window.PublicKeyCredential && typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
    try {
      const isAvailable = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      return Boolean(isAvailable);
    } catch (e) {
      return false;
    }
  }
  return false;
}

async function registerPlatformBiometrics(userIdent) {
  if (!window.PublicKeyCredential) {
    throw new Error('Biometría no soportada en este entorno');
  }
  const challenge = new Uint8Array(32);
  window.crypto.getRandomValues(challenge);
  const userId = new Uint8Array(16);
  window.crypto.getRandomValues(userId);

  const createOptions = {
    publicKey: {
      challenge,
      rp: {
        name: 'SiboPay Carné Digital',
        id: window.location.hostname
      },
      user: {
        id: userId,
        name: userIdent || 'estudiante',
        displayName: userIdent || 'Estudiante SiboPay'
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' },
        { alg: -257, type: 'public-key' }
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required'
      },
      timeout: 60000
    }
  };

  const cred = await navigator.credentials.create(createOptions);
  if (!cred) throw new Error('No se generó credencial biométrica');
  
  const rawId = Array.from(new Uint8Array(cred.rawId)).map(b => String.fromCharCode(b)).join('');
  return btoa(rawId);
}

async function verifyPlatformBiometrics(credIdBase64) {
  if (!window.PublicKeyCredential) {
    throw new Error('Biometría no disponible');
  }
  const challenge = new Uint8Array(32);
  window.crypto.getRandomValues(challenge);

  const getOptions = {
    publicKey: {
      challenge,
      timeout: 60000,
      userVerification: 'required',
      rpId: window.location.hostname
    }
  };

  if (credIdBase64) {
    try {
      const rawIdStr = atob(credIdBase64);
      const rawIdArr = new Uint8Array(rawIdStr.length);
      for (let i = 0; i < rawIdStr.length; i++) {
        rawIdArr[i] = rawIdStr.charCodeAt(i);
      }
      getOptions.publicKey.allowCredentials = [{
        type: 'public-key',
        id: rawIdArr
      }];
    } catch (err) {
      console.warn('Error parseando credencial biométrica previa:', err);
    }
  }

  const assertion = await navigator.credentials.get(getOptions);
  return Boolean(assertion);
}

async function triggerQrSecurityUnlock(onSuccess, promptTitle, promptDesc) {
  pendingQrUnlockSuccessCallback = onSuccess;
  const active = getActiveStudentForQrSecurity();
  const estId = active ? (active.id || active.codigo_estudiante || 'default') : 'default';
  const credId = localStorage.getItem('sibopay_bio_cred_' + estId);

  // Textos dinámicos en el modal de verificación
  const titleEl = document.getElementById('lblQrPinPromptTitle');
  const descEl = document.getElementById('lblQrPinPromptDesc');
  if (titleEl) {
    titleEl.textContent = promptTitle || 'Carné QR Protegido';
  }
  if (descEl) {
    descEl.textContent = promptDesc || 'Verifica tu identidad para mostrar tu código de pago en la soda.';
  }

  const bioAvailable = await checkDeviceBiometricsSupport();
  const retryContainer = document.getElementById('qrBioRetryContainer');
  if (retryContainer) {
    retryContainer.style.display = bioAvailable ? 'block' : 'none';
  }

  // Intentar inmediatamente autenticación biométrica nativa si está disponible
  if (bioAvailable && credId) {
    try {
      const verified = await verifyPlatformBiometrics(credId);
      if (verified) {
        if (window.sounds) window.sounds.playSuccess();
        if (typeof pendingQrUnlockSuccessCallback === 'function') {
          pendingQrUnlockSuccessCallback();
          pendingQrUnlockSuccessCallback = null;
        }
        return;
      }
    } catch (bioErr) {
      console.warn('Autenticación biométrica no completada o cancelada, solicitando PIN:', bioErr);
    }
  }

  // Si no hay biometría o falló/canceló, abrir modal de PIN
  showQrPinPromptModal();
}

function showQrPinPromptModal() {
  const modal = document.getElementById('modalQrPinPrompt');
  if (!modal) return;
  const pinInput = document.getElementById('inputQrPin');
  if (pinInput) pinInput.value = '';
  const err = document.getElementById('msgQrPinError');
  if (err) err.style.display = 'none';

  modal.style.display = 'flex';
  setTimeout(() => {
    if (pinInput) pinInput.focus();
  }, 150);
}

function cancelQrSecurityPrompt(e) {
  if (e && e.target !== e.currentTarget && e.currentTarget.id === 'modalQrPinPrompt') return;
  const modal = document.getElementById('modalQrPinPrompt');
  if (modal) modal.style.display = 'none';
  pendingQrUnlockSuccessCallback = null;
  resetPwaNavActive();
}

function handleQrPinInput(e) {
  const input = document.getElementById('inputQrPin');
  if (!input) return;
  const pin = input.value.trim();
  if (pin.length === 4) {
    submitQrSecurityPin();
  }
}

function submitQrSecurityPin() {
  const input = document.getElementById('inputQrPin');
  const enteredPin = input ? input.value.trim() : '';
  const validPin = getQrSecurityPin();

  if (enteredPin === validPin) {
    const modal = document.getElementById('modalQrPinPrompt');
    if (modal) modal.style.display = 'none';
    if (window.sounds) window.sounds.playSuccess();
    if (typeof pendingQrUnlockSuccessCallback === 'function') {
      pendingQrUnlockSuccessCallback();
      pendingQrUnlockSuccessCallback = null;
    }
  } else {
    if (window.sounds) window.sounds.playError();
    const err = document.getElementById('msgQrPinError');
    if (err) {
      err.style.display = 'block';
      err.textContent = '❌ PIN incorrecto. Intenta de nuevo.';
    }
    if (input) {
      input.value = '';
      input.focus();
      input.style.borderColor = '#ef4444';
      setTimeout(() => { input.style.borderColor = '#cbd5e1'; }, 1000);
    }
  }
}

async function retryQrBiometrics() {
  const active = getActiveStudentForQrSecurity();
  const estId = active ? (active.id || active.codigo_estudiante || 'default') : 'default';
  const credId = localStorage.getItem('sibopay_bio_cred_' + estId);
  try {
    const verified = await verifyPlatformBiometrics(credId);
    if (verified) {
      const modal = document.getElementById('modalQrPinPrompt');
      if (modal) modal.style.display = 'none';
      if (window.sounds) window.sounds.playSuccess();
      if (typeof pendingQrUnlockSuccessCallback === 'function') {
        pendingQrUnlockSuccessCallback();
        pendingQrUnlockSuccessCallback = null;
      }
    }
  } catch (err) {
    console.warn('Reintento biométrico cancelado:', err);
  }
}

async function openQrSecuritySettings() {
  const isParent = Boolean(currentUser && currentUser.rol === 'padre');
  // Si la seguridad YA está activa y NO es un padre ya autenticado en su portal, exigir autenticación
  if (!isParent && isQrSecurityActiveForCurrentStudent()) {
    triggerQrSecurityUnlock(() => {
      showQrSecuritySettingsModalActual();
    }, 'Administración de Seguridad', 'Verifica tu identidad con Face ID, Huella o PIN para acceder a los ajustes de seguridad.');
    return;
  }

  showQrSecuritySettingsModalActual();
}

async function showQrSecuritySettingsModalActual() {
  const modal = document.getElementById('modalQrSecuritySettings');
  if (!modal) return;
  const isEnabled = isQrSecurityActiveForCurrentStudent();
  const chk = document.getElementById('chkQrBiometricsEnabled');
  if (chk) chk.checked = isEnabled;

  const pinBackupInput = document.getElementById('inputSettingsPinBackup');
  if (pinBackupInput) pinBackupInput.value = getQrSecurityPin();

  const active = getActiveStudentForQrSecurity();
  const subEl = document.getElementById('lblQrSecuritySettingsSub');
  if (subEl) {
    subEl.textContent = active ? `Estudiante: ${active.nombre_completo || 'Seleccionado'}` : 'Protege tu código de pago en este teléfono';
  }

  const statusBox = document.getElementById('qrBioDeviceStatus');
  if (statusBox) {
    const bioAvailable = await checkDeviceBiometricsSupport();
    if (bioAvailable) {
      statusBox.style.background = '#ecfdf5';
      statusBox.style.color = '#065f46';
      statusBox.style.border = '1px solid #a7f3d0';
      statusBox.innerHTML = '✨ <strong>Sensor biométrico detectado:</strong> Compatible con Face ID, Huella dactilar o Windows Hello.';
    } else {
      statusBox.style.background = '#fffbeb';
      statusBox.style.color = '#92400e';
      statusBox.style.border = '1px solid #fde68a';
      statusBox.innerHTML = '🔒 <strong>Modo PIN Seguro:</strong> Tu carné estará protegido por tu PIN de 4 dígitos (sin sensor biométrico en este navegador).';
    }
  }

  modal.style.display = 'flex';
}

function closeQrSecuritySettings(e) {
  if (e && e.target !== e.currentTarget && e.currentTarget.id === 'modalQrSecuritySettings') return;
  const modal = document.getElementById('modalQrSecuritySettings');
  if (modal) modal.style.display = 'none';
  updateQrSecurityBadgeUI();
  updateParentQrSecurityCardUI();
}

async function toggleQrBiometricSetting(enabled) {
  const active = getActiveStudentForQrSecurity();
  const estId = active ? (active.id || active.codigo_estudiante || 'default') : 'default';
  const key = getQrSecurityKey();
  const chk = document.getElementById('chkQrBiometricsEnabled');

  const applyToggle = async (val) => {
    applyRealtimeQrSecurity(estId, val ? 1 : 0);
    if (val) {
      const bioAvailable = await checkDeviceBiometricsSupport();
      if (bioAvailable) {
        try {
          const studentIdent = active ? (active.codigo_estudiante || active.nombre_completo) : 'estudiante';
          const credId = await registerPlatformBiometrics(studentIdent);
          localStorage.setItem('sibopay_bio_cred_' + estId, credId);
        } catch (regErr) {
          console.warn('Registro biométrico omitido o cancelado por el usuario:', regErr);
        }
      }
    }
    if (chk) chk.checked = val;
    updateQrSecurityBadgeUI();
    updateParentQrSecurityCardUI();

    // Sincronizar en el backend si tenemos el ID del estudiante
    if (active && active.id) {
      try {
        const res = await fetch(`/api/estudiantes/${active.id}/limite`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bloqueo_qr_biometrico: val ? 1 : 0 })
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          console.error('Error del servidor al guardar bloqueo_qr_biometrico:', errData);
        }
      } catch (e) {
        console.warn('Error sincronizando bloqueo_qr_biometrico con el servidor:', e);
      }
    }
  };

  if (enabled) {
    await applyToggle(true);
  } else {
    const isParent = Boolean(currentUser && currentUser.rol === 'padre');
    if (isParent) {
      // El padre en su propio portal autenticado puede desactivarlo directamente
      await applyToggle(false);
      if (window.sounds) window.sounds.playSuccess();
      alert('La protección biométrica ha sido desactivada para este carné.');
    } else {
      // En modo estudiante, exigir Face ID o PIN antes de apagar
      triggerQrSecurityUnlock(async () => {
        await applyToggle(false);
        if (window.sounds) window.sounds.playSuccess();
        alert('La protección biométrica ha sido desactivada.');
      }, 'Desactivar Seguridad', 'Verifica tu identidad para confirmar la desactivación de la seguridad.');
      if (chk) chk.checked = true;
    }
  }
}

function saveSettingsPinBackup() {
  const input = document.getElementById('inputSettingsPinBackup');
  const pin = input ? input.value.trim() : '';
  if (!pin || pin.length < 4) {
    alert('El PIN debe tener 4 dígitos numéricos.');
    return;
  }
  const active = getActiveStudentForQrSecurity();
  const estId = active ? (active.id || active.codigo_estudiante || 'default') : 'default';
  localStorage.setItem('sibopay_qr_pin_' + estId, pin);
  if (active) active.pin_seguridad = pin;

  // Sincronizar también con backend
  if (active && active.id) {
    fetch('/api/padres/restablecer-acceso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        estudiante_id: active.id,
        nuevo_pin: pin
      })
    }).catch(e => console.warn('Error sincronizando PIN con backend:', e));
  }

  const msg = document.getElementById('msgSettingsPinSaved');
  if (msg) {
    msg.style.display = 'block';
    setTimeout(() => { msg.style.display = 'none'; }, 2500);
  }
}

function updateQrSecurityBadgeUI() {
  const isEnabled = isQrSecurityActiveForCurrentStudent();
  const qrBtnText = document.getElementById('qrBtnText');

  if (qrBtnText) {
    qrBtnText.textContent = isEnabled ? '🔒 Mi QR' : 'Mi QR';
  }
}

function updateParentQrSecurityCardUI() {
  const badge = document.getElementById('badgeParentQrSecStatus');
  if (!badge) return;
  const isEnabled = isQrSecurityActiveForCurrentStudent();
  if (isEnabled) {
    badge.textContent = 'Activo 🔒';
    badge.style.background = '#15803d';
    badge.style.color = '#ffffff';
  } else {
    badge.textContent = 'Inactivo';
    badge.style.background = '#64748b';
    badge.style.color = '#ffffff';
  }
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
    const isSinpeRechazado = t.tipo === 'sinpe_rechazado' || t.tipo === 'recarga_rechazada';
    const esPositivo = t.monto_colones > 0 && !isSinpeRechazado;
    const color = isSinpeRechazado ? '#be123c' : (esPositivo ? '#166534' : '#0f172a');
    const signo = isSinpeRechazado ? '' : (esPositivo ? '+' : '');
    let fecha = t.fecha;
    try {
      fecha = new Date(t.fecha).toLocaleDateString('es-CR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch(e) {}

    const safeDesc = (t.descripcion || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const safeComp = (t.comprobante_sinpe || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    return `
      <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f1f5f9; align-items: center;">
        <div>
          <div style="font-weight: 700; color: ${color};">${t.descripcion || t.tipo}</div>
          <div style="font-size: 0.7rem; color: #94a3b8;">${fecha}</div>
        </div>
        <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 3px;">
          <div style="font-weight: 800; color: ${isSinpeRechazado ? '#be123c' : (esPositivo ? '#10b981' : '#ef4444')};">
            ${isSinpeRechazado ? '₡' + Math.abs(t.monto_colones).toLocaleString('es-CR') + ' (Rechazado)' : signo + '₡' + Math.abs(t.monto_colones).toLocaleString('es-CR')}
          </div>
          ${isSinpeRechazado ? `
            <button type="button" onclick="verMotivoRechazoSinpe({ monto_colones: ${Math.abs(t.monto_colones)}, comprobante_sinpe: '${safeComp}', notas: '${safeDesc}', creado_en: '${t.fecha || ''}' })" style="background: #fff1f2; color: #be123c; border: 1px solid #fecdd3; border-radius: 5px; padding: 2px 7px; font-size: 0.65rem; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 3px;" title="Ver motivo">
              <span>Ver motivo</span>
            </button>
          ` : ''}
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

function closeTransferModal(force = false) {
  if (force && force.target && force.target.classList && force.target.classList.contains('modal-qr-backdrop')) {
    return; // Ignorar clics y arrastres sobre el fondo oscuro
  }
  const stepConfirm = document.getElementById('transferStepConfirm');
  const isConfirming = stepConfirm && stepConfirm.style.display !== 'none';
  if (force !== true && isConfirming) {
    if (!confirm('¿Deseas cancelar la transferencia en curso?')) {
      return;
    }
  }
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
      const myEscId = (currentUser && currentUser.escuela_id) || (currentStudent && currentStudent.escuela_id) || null;
      if (data.escuela_id && myEscId && Number(data.escuela_id) !== Number(myEscId)) return;
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
        loadStudentActiveOrders();
      }

      // Si es padre de este estudiante
      if (currentUser && currentUser.rol === 'padre') {
        loadParentDashboard();
        if (currentParentChild) {
          loadParentActiveOrders(currentParentChild.id);
          loadActiveChildHistory(currentParentChild.id);
        }
      }

      // Si es admin
      if (currentUser && (currentUser.rol === 'admin' || currentUser.rol === 'cajero')) {
        loadAdminData();
      }
    } catch (err) {
      console.warn('Error en SSE nueva_orden:', err);
    }
  });

  // Orden cancelada (desde app de estudiante, portal de padres o mostrador)
  sse.addEventListener('orden_cancelada', (e) => {
    try {
      if (currentStudent) {
        loadStudentActiveOrders();
        fetch(`/api/estudiantes/${currentStudent.id}`)
          .then(r => r.json())
          .then(s => { if (s && currentStudent && currentStudent.id === s.id) { currentStudent = s; updateStudentUI(); } })
          .catch(()=>{});
      }
      if (currentUser && currentUser.rol === 'padre') {
        loadParentDashboard();
        if (currentParentChild) {
          loadParentActiveOrders(currentParentChild.id);
          loadActiveChildHistory(currentParentChild.id);
        }
      }
      if (currentUser && ['admin', 'cajero', 'personal', 'dev', 'soda'].includes(currentUser.rol)) {
        loadAdminData();
      }
    } catch (err) {
      console.warn('Error en SSE orden_cancelada:', err);
    }
  });

  // Orden actualizada (cambio de estado en cocina o mostrador)
  sse.addEventListener('orden_actualizada', (e) => {
    try {
      if (currentStudent) {
        loadStudentActiveOrders();
      }
      if (currentUser && currentUser.rol === 'padre') {
        if (currentParentChild) {
          loadParentActiveOrders(currentParentChild.id);
          loadActiveChildHistory(currentParentChild.id);
        }
      }
    } catch (err) {}
  });

  // Configuración del sistema y reglas de negocio actualizadas en caliente
  sse.addEventListener('configuracion_actualizada', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data && data.configuraciones) {
        window.appConfig = data.configuraciones;
        aplicarConfiguracionPublica(window.appConfig);
      }
    } catch (err) {
      console.warn('Error en SSE configuracion_actualizada:', err);
    }
  });

  // Saldo actualizado (débito, recarga, ajuste de límite)
  sse.addEventListener('saldo_actualizado', (e) => {
    try {
      const data = JSON.parse(e.data);
      const myEscId = (currentUser && currentUser.escuela_id) || (currentStudent && currentStudent.escuela_id) || null;
      if (data.escuela_id && myEscId && Number(data.escuela_id) !== Number(myEscId)) return;
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
      const data = e.data ? JSON.parse(e.data) : null;
      const myEscId = (currentUser && currentUser.escuela_id) || (currentStudent && currentStudent.escuela_id) || null;
      if (data && data.escuela_id && myEscId && Number(data.escuela_id) !== Number(myEscId)) return;

      if (currentUser && ['admin', 'cajero', 'personal', 'dev', 'soda'].includes(currentUser.rol)) {
        loadAdminSinpeRequests();
      }
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
      const myEscId = (currentUser && currentUser.escuela_id) || (currentStudent && currentStudent.escuela_id) || null;
      if (data.escuela_id && myEscId && Number(data.escuela_id) !== Number(myEscId)) return;
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
      const myEscId = (currentUser && currentUser.escuela_id) || (currentStudent && currentStudent.escuela_id) || null;
      if (data.escuela_id && myEscId && Number(data.escuela_id) !== Number(myEscId)) return;
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
      const myEscId = (currentUser && currentUser.escuela_id) || (currentStudent && currentStudent.escuela_id) || null;
      if (sol.escuela_id && myEscId && Number(sol.escuela_id) !== Number(myEscId)) return;
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

        // 3. Refrescar solicitudes en panel admin si está abierto
        loadAdminSinpeRequests();
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
      const myEscId = (currentUser && currentUser.escuela_id) || (currentStudent && currentStudent.escuela_id) || null;
      if (prod && prod.escuela_id && myEscId && Number(prod.escuela_id) !== Number(myEscId)) return;
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

  sse.addEventListener('seguridad_qr_actualizada', (e) => {
    try {
      const data = JSON.parse(e.data);
      const estId = Number(data.id || data.estudiante_id);
      if (estId && data.bloqueo_qr_biometrico !== undefined) {
        applyRealtimeQrSecurity(estId, data.bloqueo_qr_biometrico);
      }
    } catch (err) {
      console.warn('Error en SSE seguridad_qr_actualizada:', err);
    }
  });

  sse.addEventListener('estudiante_actualizado', (e) => {
    try {
      const data = JSON.parse(e.data);
      const estId = Number(data.id || data.estudiante_id);
      if (estId && data.bloqueo_qr_biometrico !== undefined) {
        applyRealtimeQrSecurity(estId, data.bloqueo_qr_biometrico);
      }
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
        fetch(`/api/estudiantes/${estId}`).then(r => r.json()).then(s => { 
          if (s && currentStudent && currentStudent.id === s.id) { 
            currentStudent = s; 
            if (s.bloqueo_qr_biometrico !== undefined) {
              applyRealtimeQrSecurity(s.id, s.bloqueo_qr_biometrico);
            }
            updateStudentUI(); 
          } 
        }).catch(()=>{});
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

  sse.addEventListener('movimiento_registrado', (e) => {
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

  sse.addEventListener('sinpe_rechazado', (e) => {
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

  sse.addEventListener('horarios_actualizados', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data) {
        currentSchoolHorarios = data;
        window.schoolHorarios = data;
        actualizarTextosHorariosPreordenes();
        if (currentUser && currentUser.rol === 'admin') {
          const inpR1 = document.getElementById('inputAdminHoraRecreo1');
          const inpAlm = document.getElementById('inputAdminHoraAlmuerzo');
          const inpR2 = document.getElementById('inputAdminHoraRecreo2');
          if (inpR1) inpR1.value = currentSchoolHorarios.hora_recreo_1 || '09:30';
          if (inpAlm) inpAlm.value = currentSchoolHorarios.hora_almuerzo || '11:45';
          if (inpR2) inpR2.value = currentSchoolHorarios.hora_recreo_2 || '13:45';
        }
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
      // Si la sub-pantalla de SINPE está abierta, refrescar solicitudes pendientes sin alterar la vista
      const isSinpeOpen = document.getElementById('parentSubViewSinpe')?.style.display === 'block';
      if (isSinpeOpen && currentParentChild) {
        loadParentSinpeRequests(currentParentChild.id);
      }
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

function smoothScrollToElement(el, offset = 65) {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const currentY = window.pageYOffset || window.scrollY || document.documentElement.scrollTop || 0;
  const targetY = currentY + rect.top - offset;
  window.scrollTo({
    top: Math.max(0, targetY),
    behavior: 'smooth'
  });
}

function renderParentDashboardView() {
  const bannerNoHijos = document.getElementById('parentNoChildrenBanner');
  const sectionHijos = document.getElementById('parentChildrenSection');
  const containerActive = document.getElementById('parentSelectedChildContainer');
  const grid = document.getElementById('parentChildrenGrid');
  const sidebar = document.getElementById('parentSidebarBoxes');

  const hijos = (currentUser && currentUser.hijos) ? currentUser.hijos : [];

  if (hijos.length === 0) {
    if (bannerNoHijos) bannerNoHijos.style.display = 'block';
    if (sectionHijos) sectionHijos.style.display = 'none';
    if (containerActive) containerActive.style.display = 'none';
    if (grid) grid.innerHTML = '';
    return;
  }

  if (bannerNoHijos) bannerNoHijos.style.display = 'none';
  if (containerActive) containerActive.style.display = 'block';
  if (sectionHijos) sectionHijos.style.display = 'block';

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
      const initials = getStudentInitials(h.nombre_completo);
      return `
        <div class="parent-child-card ${isSelected ? 'active selected' : ''}" onclick="selectParentChild(${h.id})">
          <div style="display: flex; align-items: center; gap: 10px; min-width: 0; width: 100%;">
            <div class="child-initials-badge ${isSelected ? 'active' : ''}">
              ${initials}
            </div>
            <div style="min-width: 0; flex: 1;">
              <strong style="font-size: 0.92rem; color: var(--text-main); display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.25;">
                ${h.nombre_completo}
              </strong>
              <span style="font-size: 0.74rem; color: var(--text-muted); font-weight: 600; display: block; margin-top: 2px;">
                ${h.grado} - Sec. ${h.seccion}
              </span>
            </div>
            ${isBlocked ? '<span style="font-size: 0.65rem; background: #fee2e2; color: #dc2626; padding: 2px 6px; border-radius: 4px; font-weight: 800; flex-shrink: 0;">BLOQUEADO</span>' : ''}
          </div>
          <div style="display: flex; justify-content: space-between; align-items: flex-end; border-top: 1px solid var(--border); padding-top: 8px; margin-top: 2px; width: 100%;">
            <div>
              <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 700; display: block;">Disponible:</span>
              ${(h.saldo_retenido || 0) > 0 ? `<span style="font-size: 0.65rem; color: #b45309; font-weight: 800;">(₡${h.saldo_retenido.toLocaleString('es-CR')} retenido)</span>` : ''}
            </div>
            <strong style="font-size: 1.05rem; color: #0284c7; font-weight: 900; letter-spacing: -0.3px;">
              ₡${((typeof h.saldo_disponible === 'number') ? h.saldo_disponible : (h.saldo_colones - (h.saldo_retenido || 0))).toLocaleString('es-CR')}
            </strong>
          </div>
        </div>
      `;
    }).join('');
  }

  renderActiveChildDetails(currentParentChild);

  const isDesktop = window.innerWidth >= 860;
  let activeView = localStorage.getItem('recreopay_active_parent_subview');
  if (isDesktop && !activeView) {
    activeView = 'resumen';
  }

  if (activeView) {
    openParentSubView(activeView, false);
  } else {
    closeParentSubView(false);
  }
}

function selectParentChild(childId) {
  const hijos = (currentUser && currentUser.hijos) ? currentUser.hijos : [];
  const found = hijos.find(h => h.id === childId);
  if (found) {
    currentParentChild = found;
    renderParentDashboardView();
    updateParentQrSecurityCardUI();
    if (window.sounds) window.sounds.playTap();
  }
}

function openParentSubView(viewKey, shouldScroll = true) {
  try {
    localStorage.setItem('recreopay_active_parent_subview', viewKey);
  } catch (e) {}

  const isDesktop = window.innerWidth >= 860;
  const sidebar = document.getElementById('parentSidebarBoxes');

  // Actualizar estado activo en las cajitas del menú
  document.querySelectorAll('.parent-nav-box').forEach(box => {
    if (box.dataset.view === viewKey) {
      box.classList.add('active');
    } else {
      box.classList.remove('active');
    }
  });

  const subViews = [
    'parentSubViewResumen',
    'parentSubViewMenu',
    'parentSubViewSinpe',
    'parentSubViewAlergias',
    'parentSubViewLimites',
    'parentSubViewHistorial',
    'parentSubViewCredenciales',
    'parentSubViewDashboard'
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

  let targetId = 'parentSubViewResumen';
  if (viewKey === 'sinpe') targetId = 'parentSubViewSinpe';
  else if (viewKey === 'alergias') targetId = 'parentSubViewAlergias';
  else if (viewKey === 'limites') targetId = 'parentSubViewLimites';
  else if (viewKey === 'historial') targetId = 'parentSubViewHistorial';
  else if (viewKey === 'credenciales') targetId = 'parentSubViewCredenciales';
  else if (viewKey === 'preordenes' || viewKey === 'menu') targetId = 'parentSubViewMenu';
  else if (viewKey === 'dashboard') targetId = 'parentSubViewDashboard';
  else if (viewKey === 'resumen') targetId = 'parentSubViewResumen';

  const targetEl = document.getElementById(targetId);
  if (targetEl) {
    targetEl.style.display = 'block';
  }

  // Manejo móvil vs escritorio:
  if (!isDesktop) {
    if (viewKey) {
      if (sidebar) sidebar.style.display = 'none';
    } else {
      if (sidebar) sidebar.style.display = 'flex';
    }
  } else {
    if (sidebar) sidebar.style.display = 'flex';
  }

  if (viewKey === 'preordenes' || viewKey === 'menu') {
    renderParentCatalog();
  } else if (viewKey === 'dashboard') {
    cargarDashboardPadres();
  } else if (viewKey === 'sinpe' && currentParentChild) {
    if (typeof ensureParentSinpeSession === 'function') {
      ensureParentSinpeSession(currentParentChild);
    } else {
      obtenerNuevoCodigoSinpe();
    }
    loadParentSinpeRequests(currentParentChild.id);
  } else if (viewKey === 'historial' && currentParentChild) {
    loadActiveChildHistory(currentParentChild.id);
  } else if (viewKey === 'resumen' && currentParentChild) {
    loadParentActiveOrders(currentParentChild.id);
  } else if (viewKey === 'credenciales') {
    updateParentQrSecurityCardUI();
  }

  if (!isDesktop && targetEl && shouldScroll) {
    setTimeout(() => {
      smoothScrollToElement(targetEl, 65);
    }, 60);
  }

  if (window.sounds) window.sounds.playTap();
}

// Variables y Funciones del Dashboard Ejecutivo de Padres
let parentDashPeriodoActual = 'mes';
let parentDashHijoActual = 'todos';

function poblarSelectorHijosDashboardPadres() {
  const select = document.getElementById('parentDashChildFilter');
  if (!select) return;
  const hijos = (currentUser && currentUser.hijos) ? currentUser.hijos : [];
  
  let html = `<option value="todos">👨‍👩‍👧‍👦 Todos mis hijos (Consolidado)</option>`;
  hijos.forEach(h => {
    html += `<option value="${h.id}">${escapeHtml(h.nombre_completo)} (${escapeHtml(h.grado || 'Estudiante')})</option>`;
  });
  select.innerHTML = html;
  select.value = parentDashHijoActual;
}

async function cambiarPeriodoDashboardPadres(periodo) {
  parentDashPeriodoActual = periodo;
  const container = document.getElementById('parentDashPeriodPills');
  if (container) {
    const buttons = container.querySelectorAll('.admin-dash-pill-btn');
    buttons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.periodo === periodo);
    });
  }
  await cargarDashboardPadres();
}

async function cambiarHijoDashboardPadres(estudianteId) {
  parentDashHijoActual = estudianteId;
  await cargarDashboardPadres();
}

async function cargarDashboardPadres() {
  if (!currentUser || currentUser.rol !== 'padre') return;

  poblarSelectorHijosDashboardPadres();

  try {
    let url = `/api/padres/dashboard?padre_usuario_id=${currentUser.id}&periodo=${encodeURIComponent(parentDashPeriodoActual)}`;
    if (parentDashHijoActual && parentDashHijoActual !== 'todos') {
      url += `&estudiante_id=${encodeURIComponent(parentDashHijoActual)}`;
    }

    const res = await fetch(url);
    if (!res.ok) throw new Error('Error al cargar datos del dashboard de padres');
    const data = await res.json();
    const resumen = data.resumen || {};

    if (data.hijos && data.hijos.length > 0 && (!currentUser.hijos || currentUser.hijos.length === 0)) {
      currentUser.hijos = data.hijos;
      poblarSelectorHijosDashboardPadres();
    }

    // 1. KPI Saldo
    const elSaldo = document.getElementById('parentDashKpiSaldo');
    if (elSaldo) elSaldo.textContent = `₡${(resumen.saldo_disponible || 0).toLocaleString('es-CR')}`;

    const elSaldoMeta = document.getElementById('parentDashKpiSaldoMeta');
    if (elSaldoMeta) {
      if ((resumen.saldo_retenido || 0) > 0) {
        elSaldoMeta.innerHTML = `Retenido preórdenes: <strong style="color: #f59e0b;">₡${(resumen.saldo_retenido || 0).toLocaleString('es-CR')}</strong> • Total: ₡${(resumen.saldo_total || 0).toLocaleString('es-CR')}`;
      } else {
        elSaldoMeta.innerHTML = `Saldo total en monederos: <strong>₡${(resumen.saldo_total || 0).toLocaleString('es-CR')}</strong>`;
      }
    }

    // 2. KPI Recargas
    const elRecargas = document.getElementById('parentDashKpiRecargas');
    if (elRecargas) elRecargas.textContent = `₡${(resumen.total_recargas || 0).toLocaleString('es-CR')}`;

    const elRecargasMeta = document.getElementById('parentDashKpiRecargasMeta');
    if (elRecargasMeta) {
      elRecargasMeta.innerHTML = `SINPE Móvil: <strong>₡${(resumen.recargas_sinpe || 0).toLocaleString('es-CR')}</strong> (${resumen.cant_recargas || 0} recargas)`;
    }

    // 3. KPI Compras
    const elCompras = document.getElementById('parentDashKpiCompras');
    if (elCompras) elCompras.textContent = `₡${(resumen.total_compras || 0).toLocaleString('es-CR')}`;

    const elComprasMeta = document.getElementById('parentDashKpiComprasMeta');
    if (elComprasMeta) {
      elComprasMeta.textContent = `${resumen.cant_compras || 0} compras despachadas`;
    }

    // 4. KPI Promedio
    const elTicket = document.getElementById('parentDashKpiTicket');
    if (elTicket) elTicket.textContent = `₡${(resumen.ticket_promedio || 0).toLocaleString('es-CR')}`;

    const elTicketMeta = document.getElementById('parentDashKpiTicketMeta');
    if (elTicketMeta) {
      elTicketMeta.textContent = `Promedio de consumo por orden`;
    }

    // 5. Top Productos Consumidos
    const contTop = document.getElementById('parentDashTopProductosList');
    if (contTop) {
      const top = data.top_productos || [];
      if (top.length === 0) {
        contTop.innerHTML = `
          <div style="text-align: center; padding: 20px 10px; color: var(--text-muted); font-size: 0.8rem;">
            No hay compras registradas en este período.
          </div>
        `;
      } else {
        const maxCant = Math.max(...top.map(t => t.cantidad_total || 1));
        const medallas = ['🥇', '🥈', '🥉', '4º', '5º'];
        contTop.innerHTML = top.map((p, idx) => {
          const pct = Math.round(((p.cantidad_total || 0) / maxCant) * 100);
          return `
            <div style="display: flex; flex-direction: column; gap: 4px; padding: 6px 0; border-bottom: 1px dashed var(--border, #e2e8f0);">
              <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.82rem;">
                <span style="display: flex; align-items: center; gap: 6px; min-width: 0;">
                  <span style="font-size: 0.85rem; font-weight: 800; width: 22px;">${medallas[idx] || (idx + 1)}</span>
                  <strong style="color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(p.nombre_producto)}</strong>
                </span>
                <span style="text-align: right; flex-shrink: 0; font-weight: 800; color: #0284c7;">
                  ₡${(p.total_colones || 0).toLocaleString('es-CR')}
                  <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600; display: block;">${p.cantidad_total} uds</span>
                </span>
              </div>
              <div class="admin-dash-bar-track" style="height: 5px;">
                <div class="admin-dash-bar-fill" style="width: ${pct}%; background: linear-gradient(90deg, #34d399, #10b981);"></div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // 6. Últimos Movimientos
    const contMov = document.getElementById('parentDashMovimientosList');
    if (contMov) {
      const movs = data.movimientos || [];
      if (movs.length === 0) {
        contMov.innerHTML = `
          <div style="text-align: center; padding: 20px 10px; color: var(--text-muted); font-size: 0.8rem;">
            Sin movimientos registrados para el período seleccionado.
          </div>
        `;
      } else {
        contMov.innerHTML = movs.map(m => {
          const esIngreso = Number(m.monto_colones || 0) > 0;
          const colorMonto = esIngreso ? '#16a34a' : '#0f172a';
          const signo = esIngreso ? '+' : '';
          const fechaFmt = m.fecha ? new Date(m.fecha).toLocaleString('es-CR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
          return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: var(--bg-main, #f8fafc); border-radius: 10px; font-size: 0.8rem; border: 1px solid var(--border, #e2e8f0);">
              <div style="min-width: 0;">
                <div style="font-weight: 800; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  ${escapeHtml(m.descripcion || m.tipo)}
                </div>
                <div style="font-size: 0.70rem; color: var(--text-muted); margin-top: 1px;">
                  <span>${escapeHtml(m.estudiante_nombre)}</span> • <span>${fechaFmt}</span>
                </div>
              </div>
              <div style="text-align: right; flex-shrink: 0; font-weight: 900; color: ${colorMonto}; margin-left: 10px;">
                ${signo}₡${Math.abs(Number(m.monto_colones || 0)).toLocaleString('es-CR')}
              </div>
            </div>
          `;
        }).join('');
      }
    }
  } catch (err) {
    console.error('Error al cargar dashboard de padres:', err);
  }
}

function descargarEstadoCuentaPadresExcel() {
  if (!currentUser || currentUser.rol !== 'padre') return;
  let url = `/api/padres/export/estado-cuenta.xlsx?padre_usuario_id=${currentUser.id}&periodo=${encodeURIComponent(parentDashPeriodoActual)}`;
  if (parentDashHijoActual && parentDashHijoActual !== 'todos') {
    url += `&estudiante_id=${encodeURIComponent(parentDashHijoActual)}`;
  }
  const dateTag = new Date().toISOString().slice(0, 10);
  descargarArchivoDirecto(url, `estado_cuenta_familiar_${dateTag}.xlsx`);
}

function closeParentSubView(shouldScroll = false) {
  const isDesktop = window.innerWidth >= 860;
  if (isDesktop) {
    openParentSubView('resumen', false);
    return;
  }

  try {
    localStorage.removeItem('recreopay_active_parent_subview');
  } catch (e) {}

  const sidebar = document.getElementById('parentSidebarBoxes');
  if (sidebar) sidebar.style.display = 'flex';

  const subViews = [
    'parentSubViewResumen',
    'parentSubViewMenu',
    'parentSubViewSinpe',
    'parentSubViewAlergias',
    'parentSubViewLimites',
    'parentSubViewHistorial',
    'parentSubViewCredenciales',
    'parentSubViewDashboard'
  ];
  subViews.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  document.querySelectorAll('.parent-nav-box').forEach(box => {
    box.classList.remove('active');
  });

  if (!isDesktop) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (window.sounds) window.sounds.playTap();
}

window.addEventListener('resize', () => {
  const isDesk = window.innerWidth >= 860;
  const sidebar = document.getElementById('parentSidebarBoxes');
  if (isDesk && sidebar && sidebar.style.display === 'none') {
    sidebar.style.display = 'flex';
  }
});

function focusParentSinpeRecharge() {
  openParentSubView('sinpe');
}

function renderParentCatalog(filterTerm = '') {
  const grid = document.getElementById('parentProductsGrid');
  if (!grid) return;

  let filtered = products || [];
  if (filterTerm) {
    const term = filterTerm.toLowerCase().trim();
    if (term === '<1000') {
      filtered = filtered.filter(p => p.precio_colones < 1000);
    } else if (term === 'saludable') {
      filtered = filtered.filter(p => p.cumple_mep === 1 || p.es_saludable);
    } else {
      filtered = filtered.filter(p => 
        (p.nombre && p.nombre.toLowerCase().includes(term)) ||
        (p.descripcion && p.descripcion.toLowerCase().includes(term)) ||
        (p.categoria_nombre && p.categoria_nombre.toLowerCase().includes(term))
      );
    }
  }

  const cartBadge = document.getElementById('parentCartBadgeCount');
  if (cartBadge) {
    const totalItems = (cart || []).reduce((acc, it) => acc + (it.cantidad || 1), 0);
    cartBadge.textContent = totalItems;
  }

  if (filtered.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 30px; color: var(--text-muted);">No se encontraron alimentos con ese filtro.</div>`;
    return;
  }

  grid.innerHTML = filtered.map(prod => {
    const isOutOfStock = prod.disponible === 0 || (prod.control_stock === 1 && prod.stock <= 0);
    const mediaHtml = prod.imagen_url 
      ? `<div style="width: 100%; height: 110px; border-radius: 10px; overflow: hidden; margin-bottom: 8px; background: #f8fafc; border: 1px solid var(--border); display: flex; align-items: center; justify-content: center;">
           <img src="${prod.imagen_url}" alt="${prod.nombre}" style="width: 100%; height: 100%; object-fit: cover;">
         </div>`
      : `<div style="font-size: 2rem; text-align: center; margin-bottom: 6px;">${prod.icono || '🥪'}</div>`;

    return `
      <div class="product-card ${isOutOfStock ? 'out-of-stock' : ''}" style="background: var(--card-bg); border: 1.5px solid var(--border); border-radius: 14px; padding: 12px; display: flex; flex-direction: column; justify-content: space-between;">
        <div>
          ${mediaHtml}
          <strong style="font-size: 0.88rem; color: var(--text-main); display: block; margin-bottom: 2px;">${prod.nombre}</strong>
          <span style="font-size: 0.72rem; color: var(--text-muted); display: block; margin-bottom: 6px;">${prod.categoria_nombre || 'General'}</span>
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border);">
          <span style="font-size: 0.95rem; font-weight: 900; color: #0284c7;">₡${prod.precio_colones.toLocaleString('es-CR')}</span>
          ${isOutOfStock ? `<span style="font-size: 0.7rem; font-weight: 800; color: #ef4444;">Agotado</span>` : `
            <button type="button" class="btn-saas btn-saas-primary" onclick="addParentProductToCart(${prod.id}, event)" style="padding: 5px 12px; font-size: 0.78rem; font-weight: 800; border-radius: 8px; cursor: pointer; transition: all 0.2s ease;">+ Pre-ordenar</button>
          `}
        </div>
      </div>
    `;
  }).join('');
}

function filterParentCatalog(val) {
  renderParentCatalog(val);
}

function quickFilterParentCatalog(term) {
  const input = document.getElementById('parentCatalogSearch');
  if (input) input.value = term;
  renderParentCatalog(term);
}

function addParentProductToCart(productId, event) {
  addToCart(productId);
  const cartBadge = document.getElementById('parentCartBadgeCount');
  if (cartBadge) {
    const totalItems = (cart || []).reduce((acc, it) => acc + (it.cantidad || 1), 0);
    cartBadge.textContent = totalItems;
  }

  // Micro-interacción visual inmediata en el botón de la tarjeta seleccionada
  if (event && event.currentTarget) {
    const btn = event.currentTarget;
    const origHtml = btn.innerHTML;
    btn.style.background = '#10b981';
    btn.style.borderColor = '#059669';
    btn.style.color = '#ffffff';
    btn.style.boxShadow = '0 0 12px rgba(16, 185, 129, 0.45)';
    btn.innerHTML = '✓ ¡Agregado!';
    setTimeout(() => {
      btn.style.background = '';
      btn.style.borderColor = '';
      btn.style.color = '';
      btn.style.boxShadow = '';
      btn.innerHTML = origHtml;
    }, 750);
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

  if (avatar) {
    if (avatar.tagName === 'IMG') {
      avatar.src = child.foto_url || '/img/avatar_default.png';
    } else {
      avatar.textContent = getStudentInitials(child.nombre_completo);
    }
  }
  if (name) name.textContent = child.nombre_completo;
  if (meta) meta.textContent = `${child.grado} - Sección ${child.seccion} • Cód: ${child.codigo_estudiante}`;
  const saldoTotal = (typeof child.saldo_total === 'number') ? child.saldo_total : (child.saldo_colones || 0);
  const saldoRetenido = child.saldo_retenido || 0;
  const saldoDisponible = (typeof child.saldo_disponible === 'number') ? child.saldo_disponible : Math.max(0, saldoTotal - saldoRetenido);

  if (balance) balance.textContent = `₡${saldoDisponible.toLocaleString('es-CR')}`;

  const retenidoNote = document.getElementById('parentActiveChildRetenidoNote');
  if (retenidoNote) {
    if (saldoRetenido > 0) {
      retenidoNote.style.display = 'block';
      retenidoNote.innerHTML = `🔒 Saldo total: <strong>₡${saldoTotal.toLocaleString('es-CR')}</strong> &nbsp;|&nbsp; Retenido en pre-órdenes: <strong style="color: #92400e;">₡${saldoRetenido.toLocaleString('es-CR')}</strong>`;
    } else {
      retenidoNote.style.display = 'none';
    }
  }

  const currentLimit = child.limite_diario_colones || 3000;
  if (lblLimit) lblLimit.textContent = `₡${currentLimit.toLocaleString('es-CR')} / día`;
  if (inputCustomLimit) inputCustomLimit.value = currentLimit;
  if (rangeLimit) rangeLimit.value = currentLimit;
  if (chkTransfer) chkTransfer.checked = child.permitir_transferencias !== 0;

  // Actualizar Límite Diario en tarjeta de saldo y nombre de sede activa
  const dailyInline = document.getElementById('parentDailyLimitInlineDisplay');
  if (dailyInline) dailyInline.textContent = `₡${currentLimit.toLocaleString('es-CR')}`;
  const schoolBadge = document.getElementById('parentActiveSchoolNameBadge');
  if (schoolBadge) schoolBadge.textContent = child.escuela_nombre || 'Soda Escolar Central';

  // Actualizar Resumen General de la subvista
  const summaryBalance = document.getElementById('parentSummaryBalanceDisplay');
  const summaryLimit = document.getElementById('parentSummaryLimitDisplay');
  const summaryName = document.getElementById('parentSummaryChildName');
  const summaryAllergies = document.getElementById('parentSummaryAllergyStatus');

  if (summaryBalance) summaryBalance.textContent = `₡${saldoDisponible.toLocaleString('es-CR')}`;
  const summarySub = document.getElementById('parentSummaryRetenidoSubtitle');
  if (summarySub) {
    summarySub.textContent = saldoRetenido > 0 
      ? `● ₡${saldoRetenido.toLocaleString('es-CR')} retenido en pre-órdenes` 
      : '● Disponible para compras';
    summarySub.style.color = saldoRetenido > 0 ? '#b45309' : '#10b981';
  }
  if (summaryLimit) summaryLimit.textContent = `₡${currentLimit.toLocaleString('es-CR')}`;
  if (summaryName) summaryName.textContent = child.nombre_completo || 'Estudiante';

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

  if (summaryAllergies) {
    if (hasAlergias || child.bloquear_chucherias) {
      summaryAllergies.textContent = hasAlergias ? child.alergias : 'Veto de Chatarra';
      summaryAllergies.style.color = '#e11d48';
    } else {
      summaryAllergies.textContent = 'Sin alertas';
      summaryAllergies.style.color = '#10b981';
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
  loadParentActiveOrders(child.id);
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
      const isPreorden = o.tipo_orden === 'preorden';
      const badge = getMomentoBadge(o.momento_entrega);

      const isCanceled = o.estado === 'cancelado' || o.estado === 'expirado';
      const isDelivered = o.estado === 'entregado';
      const isActive = !isCanceled && !isDelivered;

      return `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px dashed var(--border);">
          <div style="min-width: 0; flex: 1; padding-right: 8px;">
            <div style="font-weight: 800; color: ${isCanceled ? 'var(--text-muted)' : 'var(--text-main)'}; font-size: 0.84rem; word-break: break-word; ${isCanceled ? 'text-decoration: line-through;' : ''}">${itemsStr}</div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              <span>${fecha}</span>
              <span>•</span>
              <span style="color: ${isDelivered ? '#10b981' : (isCanceled ? '#ef4444' : '#f59e0b')}; font-weight: 700;">
                ${isDelivered ? 'Entregado' : (isCanceled ? '🚫 Cancelado (Saldo liberado)' : 'Pendiente de retiro')}
              </span>
              ${isPreorden ? `
                <span style="background: ${badge.badgeBg}; color: ${badge.badgeColor}; border: 1px solid ${badge.badgeBorder}; padding: 1px 7px; border-radius: 6px; font-weight: 800; font-size: 0.7rem;">
                  ${badge.icon} ${badge.title}
                </span>
              ` : ''}
              ${isActive ? `
                <button type="button" class="btn-cancel-order-action" onclick="cancelarOrdenPadre(${o.id}, '${o.codigo_orden || 'ORD-' + o.id}', ${o.total_colones || 0})" style="padding: 2px 8px; font-size: 0.68rem; margin-left: 4px;" title="Cancelar pedido y liberar saldo">
                  🚫 Cancelar Orden
                </button>
              ` : ''}
            </div>
          </div>
          ${isCanceled ? `
            <div style="text-align: right; flex-shrink: 0;">
              <span style="text-decoration: line-through; color: #94a3b8; font-size: 0.78rem; display: block;">₡${(o.total_colones || 0).toLocaleString('es-CR')}</span>
              <span style="color: #10b981; font-size: 0.72rem; font-weight: 800;">Liberado</span>
            </div>
          ` : `
            <strong style="color: #0284c7; font-size: 0.88rem; flex-shrink: 0;">-₡${(o.total_colones || 0).toLocaleString('es-CR')}</strong>
          `}
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = '<span style="color: #ef4444; font-size: 0.78rem;">No se pudo cargar el historial.</span>';
  }
}

/**
 * Carga y renderiza las órdenes activas del hijo en el Resumen Principal de Padres
 */
async function loadParentActiveOrders(studentId) {
  const container = document.getElementById('parentSummaryActiveOrdersSection');
  const list = document.getElementById('parentSummaryActiveOrdersList');
  const countBadge = document.getElementById('parentSummaryActiveCountBadge');
  if (!container || !list) return;

  if (!studentId) {
    container.style.display = 'none';
    return;
  }

  try {
    const res = await fetch(`/api/ordenes?estudiante_id=${studentId}&estado=activos`);
    if (!res.ok) throw new Error('Error al cargar órdenes activas');
    const ordenes = await res.json();

    if (!Array.isArray(ordenes) || ordenes.length === 0) {
      container.style.display = 'none';
      list.innerHTML = '';
      return;
    }

    container.style.display = 'block';
    if (countBadge) {
      countBadge.textContent = `${ordenes.length} activo${ordenes.length === 1 ? '' : 's'}`;
    }

    list.innerHTML = ordenes.map(o => {
      const itemsStr = (o.items && o.items.length > 0)
        ? o.items.map(it => `${it.cantidad}x ${it.nombre}`).join(', ')
        : 'Pedido escolar';
      const badge = getMomentoBadge(o.momento_entrega);
      const fecha = o.creado_en ? new Date(o.creado_en).toLocaleDateString('es-CR', { hour: '2-digit', minute: '2-digit' }) : '';
      const codigo = o.codigo_orden || `ORD-${o.id}`;

      let estadoLabel = '⏳ Pendiente en cocina';
      let estadoColor = '#f59e0b';
      if (o.estado === 'en_preparacion') {
        estadoLabel = '👨‍🍳 En preparación';
        estadoColor = '#0284c7';
      } else if (o.estado === 'listo') {
        estadoLabel = '✅ Listo para retirar';
        estadoColor = '#10b981';
      }

      return `
        <div class="active-order-card">
          <div class="active-order-header">
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              <strong style="font-size: 0.85rem; color: var(--text-main);">${codigo}</strong>
              <span style="background: ${badge.badgeBg}; color: ${badge.badgeColor}; border: 1px solid ${badge.badgeBorder}; padding: 1px 7px; border-radius: 6px; font-weight: 800; font-size: 0.7rem;">
                ${badge.icon} ${badge.title}
              </span>
              <span style="font-size: 0.72rem; color: ${estadoColor}; font-weight: 800;">
                ${estadoLabel}
              </span>
            </div>
            <span style="font-size: 0.72rem; color: var(--text-muted);">${fecha}</span>
          </div>
          <div class="active-order-items">${itemsStr}</div>
          <div class="active-order-footer">
            <span style="font-size: 0.82rem; font-weight: 800; color: #0284c7;">
              Total: ₡${(o.total_colones || 0).toLocaleString('es-CR')} <small style="font-size: 0.68rem; color: var(--text-muted); font-weight: 600;">(Retenido)</small>
            </span>
            <button type="button" class="btn-cancel-order-action" onclick="cancelarOrdenPadre(${o.id}, '${codigo}', ${o.total_colones || 0})">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              <span>Cancelar Orden</span>
            </button>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.warn('Error en loadParentActiveOrders:', err);
    container.style.display = 'none';
  }
}

/**
 * Permite al padre de familia cancelar una orden de su hijo y liberar saldo
 */
async function cancelarOrdenPadre(ordenId, codigoOrden, monto) {
  const montoFmt = `₡${(monto || 0).toLocaleString('es-CR')}`;
  const ok = await appConfirmPrompt(
    '¿Cancelar Orden?',
    `¿Deseas cancelar el pedido ${codigoOrden} de ${montoFmt}? El monto retenido se liberará de inmediato al saldo disponible de tu hijo.`,
    'Sí, Cancelar Orden'
  );
  if (!ok) return;

  try {
    const res = await fetch(`/api/ordenes/${ordenId}/cancelar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usuario_rol: 'padre',
        estudiante_id: currentParentChild ? currentParentChild.id : undefined,
        motivo: 'Cancelada por el padre desde el portal familiar'
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al cancelar la orden');

    if (window.sounds) window.sounds.playCoin();
    await showAppAlert({
      title: '¡Orden Cancelada!',
      message: `El pedido ${codigoOrden} fue cancelado exitosamente. Se liberaron ${montoFmt} al saldo disponible de tu hijo.`,
      type: 'success'
    });

    if (currentParentChild) {
      await loadParentDashboard();
      await loadActiveChildHistory(currentParentChild.id);
      await loadParentActiveOrders(currentParentChild.id);
    }
  } catch (err) {
    await showAppAlert({
      title: 'Error',
      message: `No se pudo cancelar la orden: ${err.message}`,
      type: 'error'
    });
  }
}

let currentSinpeCode = '';

// ==========================================
// PERSISTENCIA DE SESIÓN ACTIVA SINPE MÓVIL
// ==========================================
const SINPE_SESSION_KEY = 'recreopay_active_sinpe_session';
const SINPE_SESSION_TTL_MS = 60 * 60 * 1000; // 60 minutos de vigencia

function getSavedSinpeSession(studentId = null) {
  try {
    const raw = localStorage.getItem(SINPE_SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session || !session.codigo) return null;
    if (studentId && session.studentId !== studentId) return null;
    if (Date.now() - (session.timestamp || 0) > SINPE_SESSION_TTL_MS) {
      localStorage.removeItem(SINPE_SESSION_KEY);
      return null;
    }
    return session;
  } catch (e) {
    return null;
  }
}

function saveSinpeSession(data) {
  try {
    const existing = getSavedSinpeSession(data.studentId) || {};
    const updated = {
      ...existing,
      ...data,
      timestamp: existing.timestamp || Date.now()
    };
    localStorage.setItem(SINPE_SESSION_KEY, JSON.stringify(updated));
  } catch (e) {}
}

function clearSinpeSession() {
  try {
    localStorage.removeItem(SINPE_SESSION_KEY);
  } catch (e) {}
}

function setParentSinpeMonto(monto) {
  const input = document.getElementById('inputParentSinpeMonto');
  if (input) {
    input.value = monto;
    input.focus();
  }
  if (currentParentChild) {
    saveSinpeSession({ studentId: currentParentChild.id, monto: String(monto) });
  }
  if (window.sounds) window.sounds.playTap();
}

async function ensureParentSinpeSession(student, forceNew = false) {
  if (!student) return;

  const display = document.getElementById('parentSinpeCodigoDisplay');
  const inputMonto = document.getElementById('inputParentSinpeMonto');
  const inputComp = document.getElementById('inputParentSinpeComprobante');
  const statusMsg = document.getElementById('parentSinpeStatusMsg');
  if (statusMsg) statusMsg.style.display = 'none';

  if (!forceNew) {
    const saved = getSavedSinpeSession(student.id);
    if (saved && saved.codigo) {
      currentSinpeCode = saved.codigo;
      if (display) display.textContent = saved.codigo;
      if (inputMonto && saved.monto) inputMonto.value = saved.monto;
      if (inputComp && saved.comprobante) inputComp.value = saved.comprobante;
      if (saved.telefono_sinpe) {
        const telEl = document.getElementById('parentSinpeNumero');
        if (telEl) telEl.textContent = saved.telefono_sinpe;
      }
      if (saved.titular_sinpe) {
        const titEl = document.getElementById('parentSinpeTitular');
        if (titEl) titEl.textContent = saved.titular_sinpe;
      }
      if (saved.escuela_nombre) {
        const escEl = document.getElementById('parentSinpeEscuelaNombre');
        if (escEl) escEl.textContent = saved.escuela_nombre;
      }
      return;
    }
  }

  await obtenerNuevoCodigoSinpe();
}

async function obtenerNuevoCodigoSinpe() {
  const display = document.getElementById('parentSinpeCodigoDisplay');
  const statusMsg = document.getElementById('parentSinpeStatusMsg');
  if (statusMsg) statusMsg.style.display = 'none';

  try {
    const studentId = currentParentChild ? currentParentChild.id : null;
    const res = await fetch('/api/sinpe/generar-codigo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estudiante_id: studentId })
    });
    const data = await res.json();
    if (data.success && data.codigo) {
      currentSinpeCode = data.codigo;
      if (display) display.textContent = data.codigo;
      if (data.telefono_sinpe) {
        const telEl = document.getElementById('parentSinpeNumero');
        if (telEl) telEl.textContent = data.telefono_sinpe;
      }
      if (data.titular_sinpe) {
        const titEl = document.getElementById('parentSinpeTitular');
        if (titEl) titEl.textContent = data.titular_sinpe;
      }
      if (data.escuela_nombre) {
        const escEl = document.getElementById('parentSinpeEscuelaNombre');
        if (escEl) escEl.textContent = data.escuela_nombre;
      }

      if (studentId) {
        const inputMonto = document.getElementById('inputParentSinpeMonto');
        const inputComp = document.getElementById('inputParentSinpeComprobante');
        saveSinpeSession({
          studentId: studentId,
          codigo: data.codigo,
          monto: inputMonto ? inputMonto.value : '',
          comprobante: inputComp ? inputComp.value : '',
          telefono_sinpe: data.telefono_sinpe || '',
          titular_sinpe: data.titular_sinpe || '',
          escuela_nombre: data.escuela_nombre || '',
          timestamp: Date.now()
        });
      }
    }
  } catch (err) {
    console.error('Error generando código SINPE:', err);
    if (!currentSinpeCode && display) {
      currentSinpeCode = 'SIBO-' + Math.random().toString(36).substring(2, 6).toUpperCase();
      display.textContent = currentSinpeCode;
      if (currentParentChild) {
        saveSinpeSession({
          studentId: currentParentChild.id,
          codigo: currentSinpeCode,
          timestamp: Date.now()
        });
      }
    }
  }
}

function copiarCodigoSinpe() {
  const code = currentSinpeCode || (document.getElementById('parentSinpeCodigoDisplay')?.textContent || '').trim();
  if (!code || code.includes('CARGANDO')) return;

  const btn = document.getElementById('btnCopiarCodigoSinpe');
  const lbl = document.getElementById('lblCopiarCodigoSinpe');

  const onCopiado = () => {
    if (window.sounds) window.sounds.playTap();
    if (lbl) lbl.textContent = '¡Copiado! ✓';
    if (btn) btn.style.background = '#059669';
    setTimeout(() => {
      if (lbl) lbl.textContent = 'Copiar código';
      if (btn) btn.style.background = '#16a34a';
    }, 2200);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code).then(onCopiado).catch(() => {
      fallbackCopyText(code, onCopiado);
    });
  } else {
    fallbackCopyText(code, onCopiado);
  }
}

function fallbackCopyText(text, cb) {
  try {
    const tempInput = document.createElement('input');
    tempInput.value = text;
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand('copy');
    document.body.removeChild(tempInput);
    if (cb) cb();
  } catch (e) {
    console.warn('No se pudo copiar automáticamente:', e);
  }
}

// Control del Modal de Validación SINPE Móvil
let sinpeProgressInterval = null;
let sinpeIsPolling = false;

let currentSinpePollingData = null;

function showSinpeModal(state, data = {}) {
  const modal = document.getElementById('modalSinpeValidacion');
  if (!modal) return;

  const stateLoading = document.getElementById('modalSinpeStateLoading');
  const stateSuccess = document.getElementById('modalSinpeStateSuccess');
  const statePending = document.getElementById('modalSinpeStatePending');
  const stateError = document.getElementById('modalSinpeStateError');
  const stateTimeout = document.getElementById('modalSinpeStateTimeout');
  const btnCloseX = document.getElementById('modalSinpeBtnCloseX');

  if (stateLoading) stateLoading.style.display = 'none';
  if (stateSuccess) stateSuccess.style.display = 'none';
  if (statePending) statePending.style.display = 'none';
  if (stateError) stateError.style.display = 'none';
  if (stateTimeout) stateTimeout.style.display = 'none';

  if (state === 'loading') {
    if (stateLoading) stateLoading.style.display = 'block';
    if (btnCloseX) btnCloseX.style.display = 'none'; // No permitir cerrar en sondeo crítico
    const sumChild = document.getElementById('modalSinpeSummaryChild');
    const sumMonto = document.getElementById('modalSinpeSummaryMonto');
    const sumCod = document.getElementById('modalSinpeSummaryCodigo');
    const stepText = document.getElementById('modalSinpeStepText');

    if (sumChild) sumChild.textContent = data.studentName || '-';
    if (sumMonto) sumMonto.textContent = `₡${(data.monto || 0).toLocaleString('es-CR')}`;
    if (sumCod) sumCod.textContent = data.codigo || '-';
    if (stepText) stepText.textContent = 'Consultando confirmación bancaria en tiempo real...';
  } else if (state === 'timeout') {
    if (stateTimeout) stateTimeout.style.display = 'block';
    if (btnCloseX) btnCloseX.style.display = 'flex';
    const tMonto = document.getElementById('modalSinpeTimeoutMonto');
    const tCod = document.getElementById('modalSinpeTimeoutCodigo');
    if (tMonto) tMonto.textContent = `₡${(data.monto || 0).toLocaleString('es-CR')}`;
    if (tCod) tCod.textContent = data.codigo || '-';
  } else if (state === 'success') {
    if (stateSuccess) stateSuccess.style.display = 'block';
    if (btnCloseX) btnCloseX.style.display = 'flex';
    const sMonto = document.getElementById('modalSinpeSuccessMonto');
    const sChild = document.getElementById('modalSinpeSuccessChild');
    const sBanco = document.getElementById('modalSinpeSuccessBanco');
    const sComp = document.getElementById('modalSinpeSuccessComp');
    const sNuevo = document.getElementById('modalSinpeSuccessNuevoSaldo');

    if (sMonto) sMonto.textContent = `₡${(data.monto || 0).toLocaleString('es-CR')}`;
    if (sChild) sChild.textContent = data.studentName || '-';
    if (sBanco) sBanco.textContent = data.banco || 'Bancario';
    if (sComp) sComp.textContent = data.comprobante || data.codigo || '-';
    if (sNuevo) sNuevo.textContent = `₡${(data.nuevoSaldo || 0).toLocaleString('es-CR')}`;
  } else if (state === 'pending') {
    if (statePending) statePending.style.display = 'block';
    if (btnCloseX) btnCloseX.style.display = 'flex';
    const pMonto = document.getElementById('modalSinpePendingMonto');
    if (pMonto) pMonto.textContent = (data.monto || 0).toLocaleString('es-CR');
  } else if (state === 'error') {
    if (stateError) stateError.style.display = 'block';
    if (btnCloseX) btnCloseX.style.display = 'flex';
    const eTitle = document.getElementById('modalSinpeErrorTitle');
    const eMsg = document.getElementById('modalSinpeErrorMessage');
    if (eTitle) eTitle.textContent = data.title || 'No se pudo validar';
    if (eMsg) eMsg.textContent = data.message || 'Ocurrió un error al procesar el SINPE.';
  }

  modal.style.display = 'flex';
}

function closeSinpeModal() {
  if (sinpeIsPolling) {
    sinpeIsPolling = false;
    clearInterval(sinpeProgressInterval);
  }
  const modal = document.getElementById('modalSinpeValidacion');
  if (modal) modal.style.display = 'none';
}

function handleSinpeBackdropClick(event) {
  // Si está validando activamente, no cerramos por clic accidental en el fondo
  if (sinpeIsPolling) return;
  closeSinpeModal();
}

function openModalSinpeTerms() {
  const modal = document.getElementById('modalSinpeTerms');
  if (modal) modal.style.display = 'flex';
}

function closeModalSinpeTerms(event) {
  if (event && event.target && event.target.id !== 'modalSinpeTerms') {
    return;
  }
  const modal = document.getElementById('modalSinpeTerms');
  if (modal) modal.style.display = 'none';
}

async function executeParentSinpeRecharge() {
  if (!currentParentChild) {
    showSinpeModal('error', {
      title: 'Estudiante no seleccionado',
      message: 'Por favor, selecciona primero al estudiante a quien deseas realizarle la recarga.'
    });
    return;
  }
  const inputMonto = document.getElementById('inputParentSinpeMonto');
  const inputComp = document.getElementById('inputParentSinpeComprobante');
  const btn = document.getElementById('btnParentValidarSinpe');
  const statusMsg = document.getElementById('parentSinpeStatusMsg');

  const monto = parseInt(inputMonto ? inputMonto.value : 0, 10);
  const comprobante = inputComp ? inputComp.value.trim() : '';
  const codigo = currentSinpeCode || (document.getElementById('parentSinpeCodigoDisplay')?.textContent || '').trim();

  if (isNaN(monto) || monto <= 0) {
    showSinpeModal('error', {
      title: 'Monto requerido',
      message: 'Ingresa un monto válido mayor a ₡0 para procesar tu recarga SINPE.'
    });
    if (inputMonto) inputMonto.focus();
    return;
  }

  if (statusMsg) statusMsg.style.display = 'none';

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation: sinpeSpin 1s linear infinite;"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/></svg>
      <span>Validando SINPE...</span>
    `;
  }

  currentSinpePollingData = {
    studentId: currentParentChild.id,
    studentName: currentParentChild.nombre_completo,
    monto,
    codigo,
    comprobante
  };

  // Abrir modal con estado LOADING (sin barra ni contador de segundos)
  showSinpeModal('loading', {
    studentName: currentParentChild.nombre_completo,
    monto: monto,
    codigo: codigo
  });

  const pollIntervalMs = 3000;   // Consulta cada 3 segundos
  const maxIntentos = 40;        // 40 intentos * 3s = 120 segundos (2 minutos)
  const startTime = Date.now();
  sinpeIsPolling = true;

  const stepText = document.getElementById('modalSinpeStepText');
  const rotatingSubtitles = [
    'Consultando confirmación bancaria en tiempo real...',
    'Sondeando comprobante con el banco...',
    'Esto podría tardar hasta 1 minuto, por favor espere...',
    'Verificando transferencias SINPE entrantes...',
    'Sincronizando estado digital del banco...'
  ];

  clearInterval(sinpeProgressInterval);
  sinpeProgressInterval = setInterval(() => {
    if (!sinpeIsPolling) {
      clearInterval(sinpeProgressInterval);
      return;
    }
    const elapsed = Date.now() - startTime;
    const stepIdx = Math.floor(elapsed / 5000) % rotatingSubtitles.length;
    if (stepText && stepText.textContent !== rotatingSubtitles[stepIdx]) {
      stepText.textContent = rotatingSubtitles[stepIdx];
    }
  }, 1000);

  try {
    let verifiedData = null;
    let definitiveError = null;

    for (let intento = 1; intento <= maxIntentos; intento++) {
      if (!sinpeIsPolling) break;

      try {
        const res = await fetch('/api/sinpe/validar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            estudiante_id: currentParentChild.id,
            padre_usuario_id: currentUser ? currentUser.id : null,
            monto,
            codigo,
            comprobante: comprobante || null
          })
        });

        const data = await res.json();

        // 1. Pago Verificado con éxito
        if (data.verificado && data.success) {
          verifiedData = data;
          break;
        }

        // 2. Error definitivo (ej. comprobante repetido o monto inválido)
        if (data.error && !data.retry) {
          definitiveError = data;
          break;
        }
      } catch (pollErr) {
        console.warn(`[SINPE Polling intento ${intento}]`, pollErr);
      }

      if (intento < maxIntentos && sinpeIsPolling) {
        await new Promise(r => setTimeout(r, pollIntervalMs));
      }
    }

    sinpeIsPolling = false;
    clearInterval(sinpeProgressInterval);

    // ============================================
    // CASO 1: VERIFICADO CON ÉXITO
    // ============================================
    if (verifiedData && verifiedData.verificado) {
      if (window.sounds) window.sounds.playCoin();

      const nuevoSaldo = typeof verifiedData.saldo_nuevo === 'number'
        ? verifiedData.saldo_nuevo
        : (currentParentChild.saldo_colones + monto);

      currentParentChild.saldo_colones = nuevoSaldo;
      renderActiveChildDetails(currentParentChild);

      if (inputMonto) inputMonto.value = '';
      if (inputComp) inputComp.value = '';

      showSinpeModal('success', {
        studentName: currentParentChild.nombre_completo,
        monto: monto,
        banco: verifiedData.banco || 'Bancario',
        comprobante: verifiedData.comprobante || verifiedData.codigo || codigo,
        codigo: codigo,
        nuevoSaldo: nuevoSaldo
      });

      await loadParentSinpeRequests(currentParentChild.id);
      clearSinpeSession();
      obtenerNuevoCodigoSinpe();
      return;
    }

    // ============================================
    // CASO 2: ERROR DEFINITIVO (REPETIDO O INVÁLIDO)
    // ============================================
    if (definitiveError) {
      if (window.sounds) window.sounds.playError();

      showSinpeModal('error', {
        title: 'Comprobante no válido',
        message: definitiveError.message || definitiveError.error || 'El comprobante ya fue utilizado o los datos no corresponden a la transferencia.'
      });
      return;
    }

    // ============================================
    // CASO 3: BANCO AÚN NO RESPONDIÓ TRAS 2 MINUTOS -> MODAL TIMEOUT
    // ============================================
    if (window.sounds) window.sounds.playTap();
    showSinpeModal('timeout', {
      studentName: currentParentChild.nombre_completo,
      monto: monto,
      codigo: codigo
    });

  } catch (err) {
    sinpeIsPolling = false;
    clearInterval(sinpeProgressInterval);
    if (window.sounds) window.sounds.playError();
    showSinpeModal('error', {
      title: 'Error de conexión',
      message: `No se pudo conectar con el servidor: ${err.message}`
    });
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <span id="btnParentValidarSinpeText">Validar SINPE</span>
      `;
    }
  }
}

async function retrySinpeWaitMore() {
  if (!currentSinpePollingData) return;
  const { studentId, studentName, monto, codigo, comprobante } = currentSinpePollingData;

  showSinpeModal('loading', {
    studentName: studentName || (currentParentChild ? currentParentChild.nombre_completo : ''),
    monto,
    codigo
  });

  const pollIntervalMs = 3000;
  const maxIntentos = 20; // 20 * 3s = 60s (1 minuto más)
  const startTime = Date.now();
  sinpeIsPolling = true;

  const stepText = document.getElementById('modalSinpeStepText');
  const rotatingSubtitles = [
    'Buscando comprobante bancario...',
    'Consultando transferencias recientes...',
    'Esto podría tardar unos momentos más...',
    'Verificando confirmación digital...'
  ];

  clearInterval(sinpeProgressInterval);
  sinpeProgressInterval = setInterval(() => {
    if (!sinpeIsPolling) {
      clearInterval(sinpeProgressInterval);
      return;
    }
    const elapsed = Date.now() - startTime;
    const stepIdx = Math.floor(elapsed / 5000) % rotatingSubtitles.length;
    if (stepText && stepText.textContent !== rotatingSubtitles[stepIdx]) {
      stepText.textContent = rotatingSubtitles[stepIdx];
    }
  }, 1000);

  try {
    let verifiedData = null;
    let definitiveError = null;

    for (let intento = 1; intento <= maxIntentos; intento++) {
      if (!sinpeIsPolling) break;

      try {
        const res = await fetch('/api/sinpe/validar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            estudiante_id: studentId,
            padre_usuario_id: currentUser ? currentUser.id : null,
            monto,
            codigo,
            comprobante: comprobante || null
          })
        });

        const data = await res.json();
        if (data.verificado && data.success) {
          verifiedData = data;
          break;
        }
        if (data.error && !data.retry) {
          definitiveError = data;
          break;
        }
      } catch (pollErr) {
        console.warn(`[SINPE Retry Polling intento ${intento}]`, pollErr);
      }

      if (intento < maxIntentos && sinpeIsPolling) {
        await new Promise(r => setTimeout(r, pollIntervalMs));
      }
    }

    sinpeIsPolling = false;
    clearInterval(sinpeProgressInterval);

    if (verifiedData && verifiedData.verificado) {
      if (window.sounds) window.sounds.playCoin();
      const nuevoSaldo = typeof verifiedData.saldo_nuevo === 'number'
        ? verifiedData.saldo_nuevo
        : ((currentParentChild ? currentParentChild.saldo_colones : 0) + monto);

      if (currentParentChild) {
        currentParentChild.saldo_colones = nuevoSaldo;
        renderActiveChildDetails(currentParentChild);
      }

      const inputMonto = document.getElementById('inputParentSinpeMonto');
      const inputComp = document.getElementById('inputParentSinpeComprobante');
      if (inputMonto) inputMonto.value = '';
      if (inputComp) inputComp.value = '';

      showSinpeModal('success', {
        studentName: studentName || (currentParentChild ? currentParentChild.nombre_completo : ''),
        monto,
        banco: verifiedData.banco || 'Bancario',
        comprobante: verifiedData.comprobante || verifiedData.codigo || codigo,
        codigo,
        nuevoSaldo
      });

      if (currentParentChild) {
        await loadParentSinpeRequests(currentParentChild.id);
      }
      clearSinpeSession();
      obtenerNuevoCodigoSinpe();
      return;
    }

    if (definitiveError) {
      if (window.sounds) window.sounds.playError();
      showSinpeModal('error', {
        title: 'Comprobante no válido',
        message: definitiveError.message || definitiveError.error || 'El comprobante ya fue utilizado o los datos no corresponden a la transferencia.'
      });
      return;
    }

    // Si después del minuto adicional aún no llega, pasamos a confirmación para revisión manual
    await confirmSinpeSendManualReview();

  } catch (err) {
    sinpeIsPolling = false;
    clearInterval(sinpeProgressInterval);
    if (window.sounds) window.sounds.playError();
    showSinpeModal('error', {
      title: 'Error de conexión',
      message: `No se pudo conectar con el servidor: ${err.message}`
    });
  }
}

async function confirmSinpeSendManualReview() {
  if (!currentSinpePollingData) return;
  const { studentId, studentName, monto, codigo, comprobante } = currentSinpePollingData;

  sinpeIsPolling = false;
  clearInterval(sinpeProgressInterval);

  if (window.sounds) window.sounds.playTap();

  try {
    await fetch('/api/sinpe/solicitar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        estudiante_id: studentId,
        padre_usuario_id: currentUser ? currentUser.id : null,
        monto,
        comprobante: comprobante || `SINPE-${codigo}`,
        codigo_detalle: codigo,
        notas: `Portal de Padres - Código: ${codigo}`
      })
    });
  } catch (solErr) {
    console.warn('Error al registrar solicitud:', solErr);
  }

  const inputMonto = document.getElementById('inputParentSinpeMonto');
  const inputComp = document.getElementById('inputParentSinpeComprobante');
  if (inputMonto) inputMonto.value = '';
  if (inputComp) inputComp.value = '';

  showSinpeModal('pending', {
    studentName: studentName || (currentParentChild ? currentParentChild.nombre_completo : ''),
    monto,
    codigo
  });

  if (currentParentChild) {
    await loadParentSinpeRequests(currentParentChild.id);
  }
  clearSinpeSession();
  obtenerNuevoCodigoSinpe();
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
    window._parentSinpeSolicitudes = solicitudes;

    if (solicitudes.length === 0) {
      box.style.display = 'none';
      list.innerHTML = '';
      return;
    }

    box.style.display = 'block';
    list.innerHTML = solicitudes.slice(0, 10).map(s => {
      const fecha = new Date(s.creado_en).toLocaleString('es-CR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      let badgeStyle = '';
      let badgeText = '';
      const isRechazado = s.estado === 'rechazada' || s.estado === 'rechazado';

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

      const refLabel = s.codigo_detalle ? `Cód: ${s.codigo_detalle}` : `Comp: #${s.comprobante_sinpe}`;

      return `
        <div style="background: ${isRechazado ? '#fff8f8' : 'white'}; border: 1px solid ${isRechazado ? '#fecaca' : '#e2e8f0'}; border-radius: 8px; padding: 8px 10px; display: flex; justify-content: space-between; align-items: center; font-size: 0.76rem; transition: all 0.15s ease;">
          <div>
            <div style="font-weight: 800; color: #0f172a;">₡${s.monto_colones.toLocaleString('es-CR')} <span style="font-weight: 600; color: #166534; font-family: monospace;">(${refLabel})</span></div>
            <div style="font-size: 0.68rem; color: #94a3b8;">${fecha}</div>
          </div>
          <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
            <span style="font-size: 0.7rem; font-weight: 800; padding: 3px 8px; border-radius: 6px; ${badgeStyle}">${badgeText}</span>
            ${isRechazado ? `
              <button type="button" onclick="verMotivoRechazoSinpe(${s.id})" style="background: #fff1f2; color: #be123c; border: 1.5px solid #fecdd3; border-radius: 6px; padding: 2px 8px; font-size: 0.68rem; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; box-shadow: 0 1px 2px rgba(190, 18, 60, 0.08); transition: all 0.15s ease;" title="Ver motivo del rechazo">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <span>Ver motivo</span>
              </button>
            ` : ''}
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
  if (lbl) lbl.textContent = `₡${parseInt(amt, 10).toLocaleString('es-CR')} / día`;
  if (window.sounds) window.sounds.playTap();
}

function onParentLimitSliderChange(val) {
  const input = document.getElementById('inputParentCustomLimit');
  const lbl = document.getElementById('lblParentDailyLimitDisplay');
  if (input) input.value = val;
  if (lbl) lbl.textContent = `₡${parseInt(val, 10).toLocaleString('es-CR')} / día`;
}

function onParentLimitInputChange(val) {
  const range = document.getElementById('rangeParentLimit');
  const lbl = document.getElementById('lblParentDailyLimitDisplay');
  const num = parseInt(val, 10);
  if (!isNaN(num) && num > 0) {
    if (range) range.value = num;
    if (lbl) lbl.textContent = `₡${num.toLocaleString('es-CR')} / día`;
  }
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
  closeParentSubView(false);
  loadParentDashboard();
  window.scrollTo({ top: 0, behavior: 'instant' });
  setTimeout(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, 40);
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

let dashboardPeriodoActual = 'hoy';

async function cambiarPeriodoDashboard(periodo) {
  dashboardPeriodoActual = periodo;
  const container = document.getElementById('adminDashPeriodPills');
  if (container) {
    const buttons = container.querySelectorAll('.admin-dash-pill-btn');
    buttons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.periodo === periodo);
    });
  }
  await cargarDashboardAdmin(periodo);
}

async function cargarDashboardAdmin(periodo = dashboardPeriodoActual) {
  try {
    const escId = (currentUser && currentUser.escuela_id) || 1;
    const res = await fetch(`/api/admin/dashboard?periodo=${encodeURIComponent(periodo)}&escuela_id=${escId}`);
    if (!res.ok) throw new Error('Error al cargar datos del dashboard');
    const data = await res.json();

    // 1. KPI Ventas
    const ord = data.ordenes || {};
    const elVentas = document.getElementById('dashKpiVentas');
    if (elVentas) elVentas.textContent = `₡${(ord.total_ventas || 0).toLocaleString('es-CR')}`;

    const elOrdenes = document.getElementById('dashKpiOrdenes');
    if (elOrdenes) elOrdenes.textContent = `${ord.ordenes_cobradas || 0} órdenes`;

    const elTicket = document.getElementById('dashKpiTicketPromedio');
    if (elTicket) elTicket.textContent = `₡${(ord.ticket_promedio || 0).toLocaleString('es-CR')} / ord`;

    // 2. KPI Monederos Estudiantes
    const saldos = data.saldos || {};
    const elCirculante = document.getElementById('dashKpiSaldoCirculante');
    if (elCirculante) elCirculante.textContent = `₡${(saldos.total_circulante || 0).toLocaleString('es-CR')}`;

    const elDisponible = document.getElementById('dashKpiSaldoDisponible');
    if (elDisponible) elDisponible.textContent = `₡${(saldos.disponible || 0).toLocaleString('es-CR')}`;

    const elRetenido = document.getElementById('dashKpiSaldoRetenido');
    if (elRetenido) elRetenido.textContent = `₡${(saldos.retenido_preordenes || 0).toLocaleString('es-CR')}`;

    // 3. KPI Recargas
    const rec = data.recargas || {};
    const elRecargas = document.getElementById('dashKpiRecargas');
    if (elRecargas) elRecargas.textContent = `₡${(rec.total_recargas || 0).toLocaleString('es-CR')}`;

    const elRecSinpe = document.getElementById('dashKpiRecargasSinpe');
    if (elRecSinpe) elRecSinpe.textContent = `₡${(rec.recargas_sinpe || 0).toLocaleString('es-CR')}`;

    const elRecEfectivo = document.getElementById('dashKpiRecargasEfectivo');
    if (elRecEfectivo) elRecEfectivo.textContent = `₡${(rec.recargas_efectivo || 0).toLocaleString('es-CR')} (${rec.cantidad_recargas || 0} recargas)`;

    // 4. KPI Canales (Preorden vs Mostrador)
    const totalVentas = ord.total_ventas || 0;
    const ratioPreorden = totalVentas > 0 ? Math.round(((ord.ventas_preorden || 0) / totalVentas) * 100) : 0;
    const elRatio = document.getElementById('dashKpiCanalRatio');
    if (elRatio) elRatio.textContent = `${ratioPreorden}% Pre-orden`;

    const elPreordenDet = document.getElementById('dashKpiPreordenDetalle');
    if (elPreordenDet) elPreordenDet.textContent = `₡${(ord.ventas_preorden || 0).toLocaleString('es-CR')} (${ord.ordenes_preorden || 0} ord)`;

    const elMostradorDet = document.getElementById('dashKpiMostradorDetalle');
    if (elMostradorDet) elMostradorDet.textContent = `₡${(ord.ventas_mostrador || 0).toLocaleString('es-CR')} (${ord.ordenes_mostrador || 0} ord)`;

    // 5. Momentos Escolares
    const contMomentos = document.getElementById('adminDashMomentosList');
    if (contMomentos) {
      const momentos = data.momentos || [];
      if (momentos.length === 0 || totalVentas === 0) {
        contMomentos.innerHTML = `
          <div style="text-align: center; padding: 20px 10px; color: var(--text-muted); font-size: 0.8rem;">
            Sin registro de ventas en los recreos para este período.
          </div>
        `;
      } else {
        contMomentos.innerHTML = momentos.map(m => {
          const pct = totalVentas > 0 ? Math.round((m.total / totalVentas) * 100) : 0;
          return `
            <div class="admin-dash-bar-row">
              <div class="admin-dash-bar-meta">
                <span style="display: flex; align-items: center; gap: 6px;">
                  <span style="width: 8px; height: 8px; border-radius: 50%; background: ${m.color}; display: inline-block;"></span>
                  <strong>${m.label}</strong>
                  <span style="color: var(--text-muted); font-size: 0.72rem; font-weight: normal;">(${m.cantidad} órdenes)</span>
                </span>
                <span>₡${m.total.toLocaleString('es-CR')} <small style="color: var(--text-muted); font-weight: normal;">(${pct}%)</small></span>
              </div>
              <div class="admin-dash-bar-track">
                <div class="admin-dash-bar-fill" style="width: ${pct}%; background: ${m.color};"></div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // 6. Top 5 Productos
    const contTop = document.getElementById('adminDashTopProductosList');
    if (contTop) {
      const top = data.top_productos || [];
      if (top.length === 0) {
        contTop.innerHTML = `
          <div style="text-align: center; padding: 20px 10px; color: var(--text-muted); font-size: 0.8rem;">
            No hay productos vendidos en este período.
          </div>
        `;
      } else {
        const maxCant = Math.max(...top.map(t => t.cantidad_total || 1));
        const medallas = ['🥇', '🥈', '🥉', '4º', '5º'];
        contTop.innerHTML = top.map((p, idx) => {
          const pct = Math.round(((p.cantidad_total || 0) / maxCant) * 100);
          return `
            <div style="display: flex; flex-direction: column; gap: 4px; padding: 6px 0; border-bottom: 1px dashed var(--border, #e2e8f0);">
              <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.82rem;">
                <span style="display: flex; align-items: center; gap: 6px; min-width: 0;">
                  <span style="font-size: 0.85rem; font-weight: 800; width: 22px;">${medallas[idx] || (idx + 1)}</span>
                  <strong style="color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(p.nombre_producto)}</strong>
                </span>
                <span style="text-align: right; flex-shrink: 0; font-weight: 800; color: #0284c7;">
                  ₡${(p.recaudacion_total || 0).toLocaleString('es-CR')}
                  <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600; display: block;">${p.cantidad_total} uds</span>
                </span>
              </div>
              <div class="admin-dash-bar-track" style="height: 5px;">
                <div class="admin-dash-bar-fill" style="width: ${pct}%; background: linear-gradient(90deg, #38bdf8, #0284c7);"></div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // 7. Gráfico Semanal 7 Días
    const contChart = document.getElementById('adminDashChart7Dias');
    if (contChart) {
      const dias = data.tendencia_7dias || [];
      const maxVenta = Math.max(...dias.map(d => d.ventas || 0), 1000);
      contChart.innerHTML = dias.map(d => {
        const heightPct = Math.max(4, Math.round(((d.ventas || 0) / maxVenta) * 100));
        const tieneVentas = (d.ventas || 0) > 0;
        return `
          <div class="admin-dash-col" title="${d.fecha}: ₡${d.ventas.toLocaleString('es-CR')} (${d.ordenes} órdenes)">
            <div class="admin-dash-col-val" style="color: ${tieneVentas ? 'var(--text-main)' : 'var(--text-muted)'}; font-weight: ${tieneVentas ? '800' : '600'};">
              ${tieneVentas ? '₡' + (d.ventas >= 1000 ? Math.round(d.ventas / 1000) + 'k' : d.ventas) : '₡0'}
            </div>
            <div class="admin-dash-col-bar" style="height: ${heightPct}%; opacity: ${tieneVentas ? '1' : '0.2'};"></div>
            <div class="admin-dash-col-lbl">${d.etiqueta}</div>
          </div>
        `;
      }).join('');
    }

    // 8. Alertas Operativas
    const contAlerts = document.getElementById('adminDashAlertsContainer');
    if (contAlerts) {
      const alertas = data.alertas || {};
      const alertItems = [];

      if (alertas.sinpe_pendientes > 0) {
        alertItems.push(`
          <div style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 9px; padding: 9px 12px; display: flex; justify-content: space-between; align-items: center; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 1rem;">🔔</span>
              <span style="font-size: 0.8rem; font-weight: 700; color: #b45309;">
                Hay <strong>${alertas.sinpe_pendientes}</strong> solicitud(es) de recarga SINPE Móvil pendientes de verificación.
              </span>
            </div>
            <button type="button" onclick="switchAdminTab('recarga')" class="btn-saas btn-saas-outline" style="height: 26px; padding: 0 10px; font-size: 0.74rem; border-color: #f59e0b; color: #b45309;">
              Revisar SINPE
            </button>
          </div>
        `);
      }

      if (alertas.productos_criticos > 0) {
        alertItems.push(`
          <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 9px; padding: 9px 12px; display: flex; justify-content: space-between; align-items: center; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 1rem;">⚠️</span>
              <span style="font-size: 0.8rem; font-weight: 700; color: #b91c1c;">
                Hay <strong>${alertas.productos_criticos}</strong> producto(s) en stock crítico o agotados en el inventario.
              </span>
            </div>
            <button type="button" onclick="switchAdminTab('inventario')" class="btn-saas btn-saas-outline" style="height: 26px; padding: 0 10px; font-size: 0.74rem; border-color: #ef4444; color: #b91c1c;">
              Ver Inventario
            </button>
          </div>
        `);
      }

      if (alertas.tarjetas_bloqueadas > 0) {
        alertItems.push(`
          <div style="background: rgba(100, 116, 139, 0.08); border: 1px solid rgba(100, 116, 139, 0.25); border-radius: 9px; padding: 9px 12px; display: flex; justify-content: space-between; align-items: center; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 1rem;">🚫</span>
              <span style="font-size: 0.8rem; font-weight: 700; color: var(--text-main);">
                Hay <strong>${alertas.tarjetas_bloqueadas}</strong> carné(s) escolar(es) con tarjeta bloqueada.
              </span>
            </div>
            <button type="button" onclick="switchAdminTab('estudiantes')" class="btn-saas btn-saas-outline" style="height: 26px; padding: 0 10px; font-size: 0.74rem;">
              Ver Carnés
            </button>
          </div>
        `);
      }

      if (alertItems.length > 0) {
        contAlerts.innerHTML = alertItems.join('');
        contAlerts.style.display = 'flex';
      } else {
        contAlerts.innerHTML = '';
        contAlerts.style.display = 'none';
      }
    }
  } catch (err) {
    console.error('Error al cargar dashboard ejecutivo:', err);
  }
}

function switchAdminTab(tabName) {
  const tabs = ['dashboard', 'inventario', 'estudiantes', 'recarga', 'movimientos', 'personal', 'horarios'];
  tabs.forEach(t => {
    const btn = document.getElementById(`btnTabAdmin${t.charAt(0).toUpperCase() + t.slice(1)}`);
    const content = document.getElementById(`adminTabContent${t.charAt(0).toUpperCase() + t.slice(1)}`);
    if (btn) btn.classList.toggle('active', t === tabName);
    if (content) content.style.display = (t === tabName) ? 'block' : 'none';
  });

  if (tabName === 'dashboard') {
    cargarDashboardAdmin();
  } else if (tabName === 'movimientos') {
    loadAdminMovimientos();
  } else if (tabName === 'personal') {
    loadAdminStaff();
  } else if (tabName === 'recarga') {
    loadAdminSinpeRequests();
    if (!adminSelectedStudent) {
      clearAdminSelectedStudent();
    }
  } else if (tabName === 'horarios') {
    cargarHorariosAdmin();
  }

  if (window.sounds) window.sounds.playTap();
}

async function cargarHorariosAdmin() {
  try {
    const escId = (currentUser && currentUser.escuela_id) || 1;
    const res = await fetch(`/api/escuela/horarios?escuela_id=${escId}`);
    const data = await res.json();
    if (data && data.horarios) {
      currentSchoolHorarios = data.horarios;
      window.schoolHorarios = data.horarios;

      const inpR1 = document.getElementById('inputAdminHoraRecreo1');
      const inpAlm = document.getElementById('inputAdminHoraAlmuerzo');
      const inpR2 = document.getElementById('inputAdminHoraRecreo2');

      if (inpR1) inpR1.value = currentSchoolHorarios.hora_recreo_1 || '09:30';
      if (inpAlm) inpAlm.value = currentSchoolHorarios.hora_almuerzo || '11:45';
      if (inpR2) inpR2.value = currentSchoolHorarios.hora_recreo_2 || '13:45';

      actualizarTextosHorariosPreordenes();
    }
  } catch (err) {
    console.error('Error cargando horarios admin:', err);
  }
}

async function guardarHorariosEscolares() {
  const inpR1 = document.getElementById('inputAdminHoraRecreo1');
  const inpAlm = document.getElementById('inputAdminHoraAlmuerzo');
  const inpR2 = document.getElementById('inputAdminHoraRecreo2');

  const hora1 = inpR1 ? inpR1.value : '09:30';
  const alm = inpAlm ? inpAlm.value : '11:45';
  const hora2 = inpR2 ? inpR2.value : '13:45';

  if (!hora1 || !alm || !hora2) {
    alert('Por favor especifica las horas de los 3 turnos (1er Recreo, Almuerzo y 2do Recreo)');
    return;
  }

  try {
    const escId = (currentUser && currentUser.escuela_id) || 1;
    const res = await fetch('/api/admin/escuela/horarios', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        escuela_id: escId,
        hora_recreo_1: hora1,
        hora_almuerzo: alm,
        hora_recreo_2: hora2
      })
    });
    const data = await res.json();
    if (data.success && data.horarios) {
      currentSchoolHorarios = data.horarios;
      window.schoolHorarios = data.horarios;
      actualizarTextosHorariosPreordenes();
      if (window.sounds) window.sounds.playCoin();
      alert(`✅ Horarios escolares guardados con éxito:\n• 1er Recreo: ${data.horarios.hora_recreo_1_fmt}\n• Almuerzo: ${data.horarios.hora_almuerzo_fmt}\n• 2do Recreo: ${data.horarios.hora_recreo_2_fmt}`);
    } else {
      alert('Error guardando horarios: ' + (data.error || 'Ocurrió un error inesperado'));
    }
  } catch (err) {
    alert('Error al comunicarse con el servidor: ' + err.message);
  }
}

function descargarReporteRecargasExcel(descargarTodo = false) {
  const escId = (currentUser && currentUser.escuela_id) || 1;
  let url = `/api/admin/export/recargas.xlsx?escuela_id=${escId}`;
  let dateTag = new Date().toISOString().slice(0, 10);
  if (!descargarTodo) {
    const desde = document.getElementById('inputExportRecargasDesde')?.value || '';
    const hasta = document.getElementById('inputExportRecargasHasta')?.value || '';
    const estado = document.getElementById('selectExportRecargasEstado')?.value || 'todos';

    const params = new URLSearchParams();
    if (desde) params.append('desde', desde);
    if (hasta) params.append('hasta', hasta);
    if (estado && estado !== 'todos') params.append('estado', estado);

    if (desde) dateTag = `${desde}_a_${hasta || desde}`;
    const qs = params.toString();
    if (qs) url += '&' + qs;
  }

  descargarArchivoDirecto(url, `recargas_sinpe_sibopay_${dateTag}.xlsx`);
}

async function loadAdminData() {
  try {
    const escId = (currentUser && currentUser.escuela_id) || 1;
    // 1. Cargar resumen y métricas
    const resResumen = await fetch(`/api/admin/resumen?escuela_id=${escId}`);
    adminStats = await resResumen.json();

    document.getElementById('adminStatVentas').textContent = `₡${adminStats.ventas_hoy.toLocaleString('es-CR')}`;
    document.getElementById('adminStatOrdenes').textContent = adminStats.ordenes_hoy;
    document.getElementById('adminStatEstudiantes').textContent = adminStats.estudiantes_activos;
    document.getElementById('adminStatBloqueados').textContent = adminStats.tarjetas_bloqueadas;
    document.getElementById('adminStatCriticos').textContent = adminStats.productos_bajo_stock;

    // 2. Cargar productos de inventario
    const resProd = await fetch(`/api/admin/productos?escuela_id=${escId}`);
    adminProducts = await resProd.json();
    renderAdminInventory(adminProducts);

    // 3. Cargar estudiantes
    const resEst = await fetch(`/api/estudiantes?escuela_id=${escId}`);
    students = await resEst.json();
    renderAdminStudents(students);
    populateAdminRecargaStudents(students);

    // 4. Si las categorías están vacías, cargarlas para los modales
    if (!categories || categories.length === 0) {
      const resCat = await fetch(`/api/productos?escuela_id=${escId}`);
      const dataCat = await resCat.json();
      if (dataCat && dataCat.categorias) {
        categories = dataCat.categorias;
      }
    }

    // 5. Cargar solicitudes SINPE pendientes para badge y sección
    loadAdminSinpeRequests();

    // 6. Cargar horarios escolares para la pestaña de configuración
    cargarHorariosAdmin();

    // 7. Cargar Dashboard Ejecutivo
    cargarDashboardAdmin();
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

    const iconBadge = window.SiboPayIcons 
      ? window.SiboPayIcons.getFoodIconBadge(p.icono, p.nombre, 'badge') 
      : `<div style="font-size: 1.8rem; text-align: center; flex-shrink: 0; min-width: 40px;">${p.icono || '🥪'}</div>`;

    const mediaBadge = p.imagen_url
      ? `<div style="width: 42px; height: 42px; border-radius: 9px; overflow: hidden; border: 1.2px solid var(--border, #e2e8f0); display: flex; align-items: center; justify-content: center; background: #f8fafc; flex-shrink: 0;">
           <img src="${p.imagen_url}" alt="${p.nombre}" style="width: 100%; height: 100%; object-fit: cover; display: block;" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';">
           <div style="display: none; width: 100%; height: 100%; align-items: center; justify-content: center;">
             ${iconBadge}
           </div>
         </div>`
      : iconBadge;

    return `
      <div class="inventory-item-row" style="${isOutOfStock ? 'background: #fff1f2;' : ''}">
        <div class="inventory-item-top" style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
          <div style="display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0;">
            <div style="flex-shrink: 0; display: flex; align-items: center; justify-content: center;">
              ${mediaBadge}
            </div>
            <div style="flex: 1; min-width: 0;">
              <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <strong style="font-size: 0.92rem; color: var(--text-main); word-break: break-word;">${p.nombre}</strong>
                ${statusPill}
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
    const escId = (currentUser && currentUser.escuela_id) || 1;
    const res = await fetch(`/api/admin/productos/${prodId}/ajuste-rapido`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta, escuela_id: escId })
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
    const escId = (currentUser && currentUser.escuela_id) || 1;
    const res = await fetch(`/api/admin/productos/${prodId}/stock`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stock: nuevoStock, control_stock: 1, escuela_id: escId })
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
    const escId = (currentUser && currentUser.escuela_id) || 1;
    const res = await fetch(`/api/admin/estudiantes/${studentId}/bloquear`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tarjeta_bloqueada: newBlocked, escuela_id: escId })
    });
    if (!res.ok) throw new Error('Error actualizando estado de tarjeta');

    if (window.sounds) window.sounds.playCoin();
    await loadAdminData();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

// ==========================================
// GESTOR DE MODALES Y FORMULARIOS PERSISTENTES
// ==========================================
function snapshotFormInitialValues(formEl) {
  if (!formEl) return;
  const elements = formEl.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select');
  elements.forEach(el => {
    if (el.type === 'checkbox' || el.type === 'radio') {
      el.dataset.initialChecked = el.checked ? 'true' : 'false';
    } else {
      el.dataset.initialVal = el.value || '';
    }
  });
}
window.snapshotFormInitialValues = snapshotFormInitialValues;

function isFormDirty(formEl) {
  if (!formEl) return false;
  const elements = formEl.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select');
  for (const el of elements) {
    if (el.type === 'checkbox' || el.type === 'radio') {
      const init = el.dataset.initialChecked === 'true';
      if (el.checked !== init) return true;
    } else {
      const initVal = el.dataset.initialVal !== undefined ? el.dataset.initialVal : '';
      const currVal = el.value || '';
      if (currVal.trim() !== initVal.trim() && currVal.trim().length > 0) {
        return true;
      }
    }
  }
  return false;
}
window.isFormDirty = isFormDirty;

// Manejador inteligente de la tecla ESC para modales de escritura / formularios
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const activeFormModals = [
      { id: 'modalDevUser', close: () => closeModalDevUser(true), formId: 'formDevUser' },
      { id: 'modalNewStudent', close: () => closeNewStudentModal(true), formId: 'formNewStudent' },
      { id: 'modalAdminProduct', close: () => closeAdminProductModal(true), formId: 'formAdminProduct' },
      { id: 'modalAdminStaff', close: () => closeAdminStaffModal(true), formId: 'formAdminStaff' },
      { id: 'modalDevPassword', close: () => closeModalDevPassword(true), formId: 'formDevPassword' },
      { id: 'modalDevEscuela', close: () => closeModalDevEscuela(true), formId: 'formDevEscuela' },
      { id: 'modalTransfer', close: () => closeTransferModal(true), formId: null },
      { id: 'modalRechazarSinpe', close: () => (typeof window.cerrarModalRechazoSinpe === 'function' ? window.cerrarModalRechazoSinpe(true) : null), formId: null }
    ];

    for (const m of activeFormModals) {
      const modalEl = document.getElementById(m.id);
      if (modalEl && modalEl.style.display !== 'none' && getComputedStyle(modalEl).display !== 'none') {
        const formEl = m.formId ? document.getElementById(m.formId) : null;
        if (formEl && isFormDirty(formEl)) {
          // Bloquear Escape si el usuario ya escribió datos para evitar pérdidas accidentales
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        // Si el formulario está vacío o sin cambios, cerrar con Escape
        e.preventDefault();
        if (typeof m.close === 'function') m.close();
        return;
      }
    }
  }
});

function openNewStudentModal() {
  window.newStudentFromDev = false;
  const escContainer = document.getElementById('newEstEscuelaContainer');
  if (escContainer) escContainer.style.display = 'none';
  const title = document.getElementById('modalNewStudentTitle');
  if (title) title.textContent = 'Registrar Nuevo Alumno';
  const modal = document.getElementById('modalNewStudent');
  if (modal) modal.style.display = 'flex';
  const form = document.getElementById('formNewStudent');
  if (form) snapshotFormInitialValues(form);
}

async function openNewStudentModalFromDev() {
  window.newStudentFromDev = true;
  const escContainer = document.getElementById('newEstEscuelaContainer');
  if (escContainer) escContainer.style.display = 'block';
  const title = document.getElementById('modalNewStudentTitle');
  if (title) title.textContent = 'Registrar Nuevo Alumno (Developer)';

  const escSelect = document.getElementById('newEstEscuelaSelect');
  if (escSelect) {
    escSelect.innerHTML = '<option value="">Cargando escuelas...</option>';
    try {
      const res = await fetch('/api/developer/escuelas');
      if (res.ok) {
        const escuelas = await res.json();
        if (Array.isArray(escuelas) && escuelas.length > 0) {
          escSelect.innerHTML = escuelas.map(e => `
            <option value="${e.id}">${escapeHtml(e.nombre)} (${escapeHtml(e.codigo || 'Sede')})</option>
          `).join('');
        } else {
          escSelect.innerHTML = '<option value="1">Soda Escolar Central (ESC01)</option>';
        }
      } else {
        escSelect.innerHTML = '<option value="1">Soda Escolar Central (ESC01)</option>';
      }
    } catch (err) {
      console.error('Error cargando escuelas en modal:', err);
      escSelect.innerHTML = '<option value="1">Soda Escolar Central (ESC01)</option>';
    }
  }

  const modal = document.getElementById('modalNewStudent');
  if (modal) modal.style.display = 'flex';
  const form = document.getElementById('formNewStudent');
  if (form) snapshotFormInitialValues(form);
}
window.openNewStudentModalFromDev = openNewStudentModalFromDev;

function closeNewStudentModal(force = false) {
  if (force && force.target && force.target.classList && force.target.classList.contains('modal-qr-backdrop')) {
    return; // Ignorar clics y arrastres sobre el fondo oscuro
  }
  const form = document.getElementById('formNewStudent');
  if (force !== true && isFormDirty(form)) {
    if (!confirm('¿Deseas salir? Hay datos del estudiante sin guardar.')) {
      return;
    }
  }
  const modal = document.getElementById('modalNewStudent');
  if (modal) modal.style.display = 'none';
  window.newStudentFromDev = false;
  if (form) form.reset();
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
    let escId = (currentUser && currentUser.escuela_id) || 1;
    const escContainer = document.getElementById('newEstEscuelaContainer');
    const escSelect = document.getElementById('newEstEscuelaSelect');
    if (window.newStudentFromDev || (escContainer && escContainer.style.display !== 'none')) {
      if (escSelect && escSelect.value) {
        escId = parseInt(escSelect.value, 10);
      }
    }

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
        prefijo,
        escuela_id: escId
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (window.sounds) window.sounds.playSuccess();
    const credsMsg = data.username_creado ? `\n\nCredenciales de Acceso:\nUsuario: ${data.username_creado}\nPIN temporal: ${data.pin_creado || '1234'}` : '';
    alert(`¡Estudiante Creado con Éxito!\n\nNombre: ${data.nombre_completo}\nCódigo Estudiante: ${data.codigo_estudiante}\nQR Token: ${data.qr_token}${credsMsg}`);

    closeNewStudentModal(true);
    document.getElementById('formNewStudent').reset();

    // Actualizar vistas correspondientes
    if (window.newStudentFromDev || (currentUser && currentUser.rol === 'developer')) {
      if (typeof loadDevUsuarios === 'function') await loadDevUsuarios();
      if (typeof loadDeveloperDashboard === 'function') await loadDeveloperDashboard();
    }
    if (typeof loadAdminData === 'function') await loadAdminData();
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
        metodo: 'Efectivo en mostrador',
        escuela_id: (currentUser && currentUser.escuela_id) || 1
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
// APROBACIÓN MANUAL DE RECARGAS SINPE EN PANEL ADMIN
// ==========================================

async function loadAdminSinpeRequests() {
  const list = document.getElementById('adminSinpeRequestsList');
  const tabBadge = document.getElementById('badgeAdminTabSinpeCount');
  const countBadge = document.getElementById('adminSinpeCountBadge');
  if (!list) return;

  try {
    const escId = (currentUser && currentUser.escuela_id) || 1;
    let url = `/api/sinpe/solicitudes?estado=pendiente&escuela_id=${escId}`;

    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const solicitudes = data.solicitudes || [];
    window.cachedAdminSinpeRequests = solicitudes;

    if (tabBadge) {
      if (solicitudes.length > 0) {
        tabBadge.textContent = solicitudes.length;
        tabBadge.style.display = 'inline-block';
      } else {
        tabBadge.style.display = 'none';
      }
    }

    if (countBadge) {
      if (solicitudes.length > 0) {
        countBadge.textContent = solicitudes.length;
        countBadge.style.display = 'inline-block';
      } else {
        countBadge.style.display = 'none';
      }
    }

    if (solicitudes.length === 0) {
      list.innerHTML = `
        <div style="background: #f8fafc; border: 1.5px dashed #cbd5e1; border-radius: 14px; padding: 36px 20px; text-align: center; color: #64748b;">
          <div style="font-size: 2.2rem; margin-bottom: 6px;">✨</div>
          <strong style="color: #0f172a; font-size: 1rem; display: block; margin-bottom: 2px;">No hay recargas SINPE pendientes</strong>
          <p style="font-size: 0.82rem; margin: 0; color: #94a3b8;">Todas las recargas reportadas por los padres han sido procesadas.</p>
        </div>
      `;
      return;
    }

    list.innerHTML = solicitudes.map(s => {
      const fecha = new Date(s.creado_en).toLocaleString('es-CR', { 
        day: '2-digit', 
        month: 'short', 
        hour: '2-digit', 
        minute: '2-digit' 
      });

      return `
        <div class="sinpe-admin-card" style="background: #ffffff; border: 1.5px solid #86efac; border-radius: 14px; padding: 14px 14px; box-shadow: 0 2px 8px rgba(16, 185, 129, 0.08); display: flex; flex-direction: column; gap: 10px; width: 100%; max-width: 100%; box-sizing: border-box; overflow: hidden;">
          
          <!-- FILA 1: ESTUDIANTE Y MONTO -->
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; width: 100%; box-sizing: border-box;">
            <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">
              <div style="width: 42px; height: 42px; border-radius: 12px; background: linear-gradient(135deg, #0284c7, #0369a1); color: #ffffff; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 0.95rem; border: 1.5px solid #bae6fd; flex-shrink: 0; box-shadow: 0 2px 6px rgba(2, 132, 199, 0.15);">
                ${getStudentInitials(s.estudiante_nombre)}
              </div>
              <div style="min-width: 0; flex: 1;">
                <div style="font-weight: 900; font-size: 1rem; color: #0f172a; line-height: 1.2; word-break: normal; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  ${escapeHtml(s.estudiante_nombre)}
                </div>
                <div style="font-size: 0.75rem; color: #64748b; margin-top: 1px; font-weight: 600;">
                  ${escapeHtml(s.estudiante_grado || 'Estudiante')} ${s.estudiante_seccion ? '• Sec. ' + escapeHtml(s.estudiante_seccion) : ''}
                </div>
              </div>
            </div>

            <div style="text-align: right; flex-shrink: 0;">
              <div style="font-size: 1.25rem; font-weight: 900; color: #16a34a; letter-spacing: -0.5px; line-height: 1;">
                +₡${s.monto_colones.toLocaleString('es-CR')}
              </div>
              <div style="display: inline-block; font-size: 0.68rem; font-weight: 800; color: #b45309; background: #fef3c7; border: 1px solid #fde68a; padding: 2px 6px; border-radius: 6px; margin-top: 3px;">
                ⏳ Por Verificar
              </div>
            </div>
          </div>

          <!-- FILA 2: DATOS DEL COMPROBANTE Y DETALLE -->
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 8px 12px; display: flex; flex-direction: column; gap: 6px; font-size: 0.80rem; box-sizing: border-box;">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
              <div style="display: flex; align-items: center; gap: 5px;">
                <span style="color: #64748b; font-weight: 700; font-size: 0.72rem; text-transform: uppercase;">Código:</span>
                <span style="font-family: monospace; font-size: 0.88rem; font-weight: 900; color: #16a34a; background: #dcfce7; padding: 2px 7px; border-radius: 6px; border: 1px solid #bbf7d0;">
                  ${escapeHtml(s.codigo_detalle || '-')}
                </span>
              </div>
              <div style="display: flex; align-items: center; gap: 5px;">
                <span style="color: #64748b; font-weight: 700; font-size: 0.72rem; text-transform: uppercase;">Saldo:</span>
                <span style="color: #334155; font-weight: 800; font-size: 0.82rem;">₡${(s.estudiante_saldo || 0).toLocaleString('es-CR')}</span>
              </div>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; border-top: 1px dashed #e2e8f0; padding-top: 5px;">
              <div style="display: flex; align-items: center; gap: 5px; min-width: 0; flex: 1;">
                <span style="color: #64748b; font-weight: 700; font-size: 0.72rem; text-transform: uppercase; flex-shrink: 0;">Comp:</span>
                <span style="font-family: monospace; font-size: 0.80rem; font-weight: 800; color: #0369a1; background: #e0f2fe; padding: 2px 6px; border-radius: 6px; border: 1px solid #bae6fd; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  #${escapeHtml(s.comprobante_sinpe || '-')}
                </span>
              </div>
              <div style="font-size: 0.73rem; color: #64748b; font-weight: 600; flex-shrink: 0;">
                ${fecha}
              </div>
            </div>
          </div>

          ${s.notas ? `
            <div style="font-size: 0.75rem; color: #475569; background: #ffffff; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 5px 10px; display: flex; align-items: center; gap: 6px; box-sizing: border-box; overflow: hidden;">
              <span style="flex-shrink: 0;">💬</span>
              <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"><strong>Detalle:</strong> ${escapeHtml(s.notas)}</span>
            </div>
          ` : ''}

          <!-- FILA 3: BOTONES DE ACCIÓN (RECHAZAR / APROBAR) -->
          <div style="display: flex; gap: 8px; align-items: center; width: 100%; border-top: 1px solid #f1f5f9; padding-top: 8px; box-sizing: border-box;">
            <button type="button" onclick="procesarSinpeAdmin(${s.id}, 'rechazar')" style="flex: 0 0 auto; width: 95px; padding: 10px 8px; background: #fff1f2; color: #e11d48; border: 1.5px solid #fecdd3; border-radius: 10px; font-weight: 800; font-size: 0.82rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px; box-sizing: border-box; transition: all 0.15s;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              <span>Rechazar</span>
            </button>
            <button type="button" onclick="procesarSinpeAdmin(${s.id}, 'aprobar')" style="flex: 1 1 0; min-width: 0; padding: 10px 8px; background: linear-gradient(135deg, #16a34a, #15803d); color: white; border: none; border-radius: 10px; font-weight: 900; font-size: 0.86rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 2px 8px rgba(22, 163, 74, 0.25); box-sizing: border-box; transition: all 0.15s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink: 0;"><polyline points="20 6 9 17 4 12"/></svg>
              <span>Aprobar (+₡${s.monto_colones.toLocaleString('es-CR')})</span>
            </button>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Error cargando solicitudes SINPE en panel admin:', err);
  }
}

async function procesarSinpeAdmin(solicitudId, accion) {
  if (accion === 'aprobar') {
    const ok = await showAppConfirm({
      title: 'Aprobar Recarga SINPE',
      message: '¿Confirmas que verificaste el comprobante y el dinero ya ingresó a la cuenta bancaria de la soda?',
      type: 'question',
      confirmText: 'Sí, Aprobar'
    });
    if (!ok) return;

    try {
      const escId = (currentUser && currentUser.escuela_id) || 1;
      const res = await fetch('/api/sinpe/procesar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          solicitud_id: solicitudId,
          accion: 'aprobar',
          usuario_id: currentUser ? currentUser.id : null,
          escuela_id: escId
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (window.sounds) window.sounds.playCoin();
      await showAppAlert({
        title: '¡Recarga Aprobada!',
        message: `Se acreditaron ₡${data.resultado.monto.toLocaleString('es-CR')} al estudiante ${data.resultado.estudiante_nombre}.\nNuevo saldo: ₡${data.resultado.saldo_nuevo.toLocaleString('es-CR')}.`,
        type: 'success'
      });
      loadAdminSinpeRequests();
      await loadAdminData();
    } catch (err) {
      if (window.sounds) window.sounds.playError();
      showAppAlert({
        title: 'Error al Aprobar',
        message: err.message,
        type: 'error'
      });
    }
  } else if (accion === 'rechazar') {
    const sol = (window.cachedAdminSinpeRequests || []).find(s => s.id == solicitudId) || {};
    if (typeof window.abrirModalRechazoSinpe === 'function') {
      window.abrirModalRechazoSinpe({
        id: solicitudId,
        estudiante_nombre: sol.estudiante_nombre,
        monto_colones: sol.monto_colones,
        comprobante: sol.comprobante_sinpe || sol.codigo_detalle,
        onConfirm: async (motivo) => {
          try {
            const escId = (currentUser && currentUser.escuela_id) || 1;
            const res = await fetch('/api/sinpe/procesar', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                solicitud_id: solicitudId,
                accion: 'rechazar',
                motivo: motivo || 'Rechazado por la soda',
                usuario_id: currentUser ? currentUser.id : null,
                escuela_id: escId
              })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            await showAppAlert({
              title: 'Recarga Rechazada',
              message: 'La solicitud de recarga ha sido rechazada y su motivo ha quedado guardado para trazabilidad.',
              type: 'warning'
            });
            loadAdminSinpeRequests();
            await loadAdminData();
          } catch (err) {
            showAppAlert({
              title: 'Error al Rechazar',
              message: err.message,
              type: 'error'
            });
          }
        }
      });
    } else {
      console.error('abrirModalRechazoSinpe no está disponible globalmente');
    }
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

    const escId = (currentUser && currentUser.escuela_id) || 1;
    const res = await fetch(`/api/admin/movimientos?limit=100&escuela_id=${escId}&_t=` + Date.now());
    if (!res.ok) throw new Error('Error al cargar movimientos desde el servidor');
    adminMovimientosData = await res.json();
    renderAdminMovimientos();
  } catch (err) {
    console.error('Error cargando movimientos:', err);
    container.innerHTML = `<div style="text-align: center; color: #ef4444; padding: 25px; font-weight: 700;">Error al cargar el historial: ${err.message}</div>`;
  }
}
window.loadAdminMovimientos = loadAdminMovimientos;

function setMovFilter(filter) {
  currentMovFilter = filter;
  const btnAll = document.getElementById('btnFilterMovAll');
  const btnRecargas = document.getElementById('btnFilterMovRecargas');
  const btnCobros = document.getElementById('btnFilterMovCobros');
  const btnRechazados = document.getElementById('btnFilterMovRechazados');

  [btnAll, btnRecargas, btnCobros, btnRechazados].forEach(b => {
    if (!b) return;
    b.classList.remove('active');
    b.style.setProperty('background', 'transparent', 'important');
    b.style.setProperty('color', '#64748b', 'important');
    b.style.setProperty('box-shadow', 'none', 'important');
    b.style.setProperty('font-weight', '700', 'important');
  });

  const isRechazadosTab = filter === 'rechazados' || filter === 'rechazado';
  const activeBtn = filter === 'recargas' ? btnRecargas : (filter === 'cobros' ? btnCobros : (isRechazadosTab ? btnRechazados : btnAll));
  if (activeBtn) {
    activeBtn.classList.add('active');
    activeBtn.style.setProperty('background', '#ffffff', 'important');
    activeBtn.style.setProperty('color', '#0284c7', 'important');
    activeBtn.style.setProperty('box-shadow', '0 1px 4px rgba(0,0,0,0.08)', 'important');
    activeBtn.style.setProperty('font-weight', '800', 'important');
  }

  if (!adminMovimientosData || adminMovimientosData.length === 0) {
    loadAdminMovimientos();
  } else {
    renderAdminMovimientos();
  }
  if (window.sounds) window.sounds.playTap();
}
window.setMovFilter = setMovFilter;

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
      if (m.monto_colones <= 0 || m.tipo === 'compra_mostrador' || m.tipo === 'preorden' || m.tipo === 'sinpe_rechazado' || m.tipo === 'recarga_rechazada') return false;
    } else if (currentMovFilter === 'cobros') {
      if (m.monto_colones >= 0 && (m.tipo === 'recarga_manual' || m.tipo === 'recarga_sinpe' || m.tipo === 'sinpe_rechazado' || m.tipo === 'recarga_rechazada')) return false;
    } else if (currentMovFilter === 'rechazados' || currentMovFilter === 'rechazado') {
      if (m.tipo !== 'sinpe_rechazado' && m.tipo !== 'recarga_rechazada') return false;
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
    const isRechazados = currentMovFilter === 'rechazados' || currentMovFilter === 'rechazado';
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 35px 20px; background: #f8fafc; border-radius: 14px; border: 1.5px dashed var(--border);">
        <div style="display: flex; justify-content: center; margin-bottom: 8px;">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="${isRechazados ? '#e11d48' : 'currentColor'}" stroke-width="2" style="opacity: ${isRechazados ? '0.7' : '0.4'};">
            ${isRechazados 
              ? '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>' 
              : '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'}
          </svg>
        </div>
        <p style="margin: 8px 0 2px 0; font-weight: 800; font-size: 0.95rem; color: var(--text-main);">
          ${isRechazados ? 'No hay transferencias SINPE rechazadas' : 'No se encontraron movimientos'}
        </p>
        <span style="font-size: 0.78rem; color: var(--text-muted);">
          ${isRechazados ? 'Todas las transferencias registradas han sido procesadas con éxito o están pendientes de revisión.' : 'No hay registros que coincidan con el filtro o búsqueda actual.'}
        </span>
      </div>
    `;
    return;
  }

  const isCajero = currentUser && currentUser.rol === 'cajero';

  container.innerHTML = filtered.map(m => {
    const isSinpeRechazado = m.tipo === 'sinpe_rechazado' || m.tipo === 'recarga_rechazada';
    const isPositive = m.monto_colones > 0 && !isSinpeRechazado;
    const isRevertida = m.revertida === 1;
    const isReversionOrRefund = m.tipo === 'reversion_recarga' || m.tipo === 'reembolso';

    // Determinar badge de tipo
    let tipoBadge = '';
    if (m.tipo === 'recarga_manual') {
      tipoBadge = `<span style="background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; font-size: 0.7rem; font-weight: 800; padding: 3px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/></svg> Recarga Efectivo</span>`;
    } else if (m.tipo === 'recarga_sinpe') {
      tipoBadge = `<span style="background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; font-size: 0.7rem; font-weight: 800; padding: 3px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg> Recarga SINPE</span>`;
    } else if (isSinpeRechazado) {
      tipoBadge = `<span style="background: #fff1f2; color: #be123c; border: 1.5px solid #fecdd3; font-size: 0.7rem; font-weight: 900; padding: 3px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> SINPE Rechazado</span>`;
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

    // Monto formateado
    const absMonto = Math.abs(m.monto_colones);
    let montoDisplay = '';
    let montoColor = '';
    let montoBg = '';
    let montoBorder = '';
    let montoIcon = '';

    if (isSinpeRechazado) {
      montoDisplay = `₡${absMonto.toLocaleString('es-CR')} (Rechazado)`;
      montoColor = '#be123c';
      montoBg = '#fff1f2';
      montoBorder = '#fecdd3';
      montoIcon = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    } else {
      montoDisplay = isPositive ? `+₡${absMonto.toLocaleString('es-CR')}` : `-₡${absMonto.toLocaleString('es-CR')}`;
      montoColor = isPositive ? '#166534' : '#991b1b';
      montoBg = isPositive ? '#f0fdf4' : '#fef2f2';
      montoBorder = isPositive ? '#bbf7d0' : '#fecaca';
      montoIcon = isPositive 
        ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>'
        : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>';
    }

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
    } else if (isSinpeRechazado) {
      actionHtml = `
        <span style="display: inline-flex; align-items: center; gap: 4px; background: #fff1f2; color: #be123c; border: 1px solid #fecdd3; padding: 4px 10px; border-radius: 7px; font-size: 0.72rem; font-weight: 800;">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Denegado
        </span>
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
      <div class="admin-mov-card" style="background: ${isRevertida ? 'rgba(254, 242, 242, 0.45)' : (isSinpeRechazado ? 'rgba(255, 241, 242, 0.35)' : 'var(--card-bg)')}; border: 1.5px solid ${isRevertida ? '#fecaca' : (isSinpeRechazado ? '#fecdd3' : 'var(--border)')}; border-radius: 14px; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; opacity: ${isRevertida ? '0.85' : '1'}; transition: all 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
        
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
              <div style="font-size: 0.74rem; color: ${isSinpeRechazado ? '#991b1b' : 'var(--text-muted)'}; margin-top: 4px; background: ${isSinpeRechazado ? '#fff1f2' : 'rgba(148, 163, 184, 0.08)'}; border: ${isSinpeRechazado ? '1px solid #fecdd3' : 'none'}; padding: ${isSinpeRechazado ? '4px 9px' : '3px 8px'}; border-radius: 6px; line-height: 1.35; display: inline-block; font-weight: ${isSinpeRechazado ? '700' : 'normal'};">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${isSinpeRechazado ? '#e11d48' : 'currentColor'}" stroke-width="${isSinpeRechazado ? '2.5' : '2'}" style="margin-right: 4px; vertical-align: -2px;">${isSinpeRechazado ? '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>' : '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>'}</svg>${isSinpeRechazado ? '<strong style="color: #be123c;">Motivo del Rechazo:</strong> ' : ''}${m.descripcion.replace(/^SINPE Rechazado:\s*/, '')}
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
              ${isSinpeRechazado ? 'Saldo sin cambios:' : 'Saldo posterior:'} <strong style="color: var(--text-main); font-weight: 800;">₡${(m.saldo_posterior || 0).toLocaleString('es-CR')}</strong>
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

  const conf = await showAppConfirm({
    title: 'Confirmar Reversión',
    message: `¿Estás seguro de revertir ${accionTexto}?\n\n• Alumno: ${nombreEstudiante}\n• Monto: ₡${monto.toLocaleString('es-CR')}\n\n${efectoTexto}`,
    type: 'danger',
    confirmText: 'Sí, Revertir'
  });

  if (!conf) return;

  try {
      const escId = (currentUser && currentUser.escuela_id) || 1;
      const res = await fetch(`/api/admin/movimientos/${transaccionId}/revertir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usuario_id: currentUser ? currentUser.id : null,
          usuario_rol: currentUser ? currentUser.rol : 'admin',
          escuela_id: escId
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
      const escId = (currentUser && currentUser.escuela_id) || 1;
      const res = await fetch(`/api/productos?escuela_id=${escId}`);
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
  document.getElementById('adminProdIcono').value = 'sandwich';
  document.getElementById('adminProdDescripcion').value = '';
  document.getElementById('adminProdControlStock').checked = true;
  toggleStockInput(true);
  document.getElementById('adminProdStock').value = '15';
  document.getElementById('adminProdMep').value = '1';

  if (window.SiboPayIcons) {
    window.SiboPayIcons.renderIconPicker('adminProdIconPickerList', 'adminProdIcono', 'adminProdIconPreview', 'sandwich');
  }

  const btnDel = document.getElementById('btnDeleteProduct');
  if (btnDel) btnDel.style.display = 'none';

  const btnSubmit = document.getElementById('btnSaveProductSubmit');
  if (btnSubmit) btnSubmit.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> <span>Guardar Producto</span>';

  populateCategorySelect();
  modal.style.display = 'flex';
  const form = document.getElementById('formAdminProduct');
  if (form) snapshotFormInitialValues(form);
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
  document.getElementById('adminProdIcono').value = prod.icono || 'sandwich';
  document.getElementById('adminProdDescripcion').value = prod.descripcion || '';
  
  const hasControl = prod.control_stock === 1;
  document.getElementById('adminProdControlStock').checked = hasControl;
  toggleStockInput(hasControl);
  document.getElementById('adminProdStock').value = prod.stock !== undefined ? prod.stock : 0;
  document.getElementById('adminProdMep').value = (prod.cumple_mep !== undefined ? prod.cumple_mep : 1);

  if (window.SiboPayIcons) {
    window.SiboPayIcons.renderIconPicker('adminProdIconPickerList', 'adminProdIcono', 'adminProdIconPreview', prod.icono || 'sandwich');
  }

  const btnDel = document.getElementById('btnDeleteProduct');
  if (btnDel) btnDel.style.display = 'inline-block';

  const btnSubmit = document.getElementById('btnSaveProductSubmit');
  if (btnSubmit) btnSubmit.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> <span>Actualizar Producto</span>';

  populateCategorySelect(prod.categoria_id);
  modal.style.display = 'flex';
  const form = document.getElementById('formAdminProduct');
  if (form) snapshotFormInitialValues(form);
  if (window.sounds) window.sounds.playTap();
}

function closeAdminProductModal(force = false) {
  if (force && force.target && force.target.classList && force.target.classList.contains('modal-qr-backdrop')) {
    return; // Ignorar clics y arrastres sobre el fondo oscuro
  }
  const form = document.getElementById('formAdminProduct');
  if (force !== true && isFormDirty(form)) {
    if (!confirm('¿Deseas descartar los cambios? Hay datos del producto sin guardar.')) {
      return;
    }
  }
  const modal = document.getElementById('modalAdminProduct');
  if (modal) modal.style.display = 'none';
  if (form) form.reset();
}

async function submitAdminProduct(e) {
  if (e) e.preventDefault();

  const idVal = document.getElementById('adminProdId').value;
  const nombre = document.getElementById('adminProdNombre').value.trim();
  const categoria_id = parseInt(document.getElementById('adminProdCategoria').value, 10);
  const precio_colones = parseInt(document.getElementById('adminProdPrecio').value, 10);
  const icono = document.getElementById('adminProdIcono').value.trim() || 'sandwich';
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
    cumple_mep,
    escuela_id: (currentUser && currentUser.escuela_id) || 1
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
    closeAdminProductModal(true);
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
    const escId = (currentUser && currentUser.escuela_id) || 1;
    const res = await fetch(`/api/admin/productos/${idVal}?escuela_id=${escId}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al eliminar producto');

    if (window.sounds) window.sounds.playSuccess();
    closeAdminProductModal(true);
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

    const escId = (currentUser && currentUser.escuela_id) || 1;
    const res = await fetch(`/api/admin/personal?escuela_id=${escId}`);
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
              ${s.escuela_nombre ? `<span style="font-size:0.75rem; background:rgba(2,132,199,0.1); color:#0284c7; padding:2px 8px; border-radius:12px; font-weight:700;">🏫 ${escapeHtml(s.escuela_nombre)}</span>` : ''}
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
  const form = document.getElementById('formAdminStaff');
  if (form) snapshotFormInitialValues(form);
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
  const form = document.getElementById('formAdminStaff');
  if (form) snapshotFormInitialValues(form);
  if (window.sounds) window.sounds.playTap();
}

function closeAdminStaffModal(force = false) {
  if (force && force.target && force.target.classList && force.target.classList.contains('modal-qr-backdrop')) {
    return; // Ignorar clics y arrastres sobre el fondo oscuro
  }
  const form = document.getElementById('formAdminStaff');
  if (force !== true && isFormDirty(form)) {
    if (!confirm('¿Deseas descartar los cambios? Hay datos del empleado sin guardar.')) {
      return;
    }
  }
  const modal = document.getElementById('modalAdminStaff');
  if (modal) modal.style.display = 'none';
  if (form) form.reset();
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
    email,
    escuela_id: (currentUser && currentUser.escuela_id) || 1
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
    closeAdminStaffModal(true);
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
    const escId = (currentUser && currentUser.escuela_id) || 1;
    const res = await fetch(`/api/admin/personal/${staffId}/estado`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activo: nuevoEstado, escuela_id: escId })
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
    const escId = (currentUser && currentUser.escuela_id) || 1;
    const res = await fetch(`/api/admin/personal/${staffId}?escuela_id=${escId}`, {
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
    if (currentStudent.card_theme && themes.some(t => t.id === currentStudent.card_theme)) {
      return currentStudent.card_theme;
    }
  }
  if (currentUser && currentUser.card_theme && themes.some(t => t.id === currentUser.card_theme)) {
    return currentUser.card_theme;
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
  const studentGradeOnly = (currentStudent && currentStudent.grado) ? `${currentStudent.grado} • Sección ${currentStudent.seccion || 'A'}` : '2° Grado • Sección 2-A';
  const studentCodeOnly = (currentStudent && currentStudent.codigo_estudiante) ? currentStudent.codigo_estudiante : 'EST-2026-001';
  const studentBalance = (currentStudent && currentStudent.saldo_colones !== undefined) ? currentStudent.saldo_colones.toLocaleString('es-CR') : '5.300';

  container.innerHTML = themes.map((t, idx) => {
    const isSelected = (t.id === currentTheme);
    const bgStyle = t.imagen_url ? `background-image: url('${t.imagen_url}');` : '';
    const contrastClass = t.estilo_texto === 'light' ? 'card-style-light' : 'card-style-dark';

    return `
      <div class="card-carousel-slide" data-index="${idx}" data-theme="${t.id}">
        <!-- Vista previa de la tarjeta real (SIN ASTERISCOS) -->
        <div class="wallet-card has-custom-bg ${contrastClass}" style="margin: 0; cursor: pointer; transition: transform 0.2s; ${bgStyle}" onclick="selectCardTheme('${t.id}')">
          <div class="card-chip-container" style="justify-content: flex-end;">
            <div class="card-contactless-wave"><span>)</span><span>)</span><span>)</span></div>
          </div>
          <div class="student-info">
            <div class="student-avatar">${getStudentInitials(studentName)}</div>
            <div class="student-meta" style="flex: 1; min-width: 0;">
              <h2 style="margin: 0; font-size: 1.05rem; font-weight: 800; word-break: break-word;">${studentName}</h2>
              <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 3px;">
                <span class="student-grade" style="font-size: 0.72rem;">${studentGradeOnly}</span>
                <span class="card-glass-badge">Cód: ${studentCodeOnly}</span>
              </div>
            </div>
          </div>
          <div class="balance-row">
            <div class="balance-col">
              <div class="label" style="font-size: 0.68rem; font-weight: 800; margin-bottom: 3px;">SALDO DISPONIBLE</div>
              <div class="amount">
                <span class="card-balance-glass" style="font-size: 1.25rem; font-weight: 900;">₡${studentBalance}</span>
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
    currentStudent.card_theme = themeId;
    fetch(`/api/estudiantes/${currentStudent.id}/card-theme`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card_theme: themeId })
    }).catch(e => console.warn('No se pudo guardar tema en servidor:', e));
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
          ${u.escuela_nombre ? `<div style="font-size: 0.68rem; color: #0284c7; background: #e0f2fe; border: 1px solid #bae6fd; display: inline-flex; align-items: center; gap: 3px; padding: 1px 6px; border-radius: 4px; margin-top: 3px; font-weight: 700;">🏫 ${escapeHtml(u.escuela_nombre)}</div>` : ''}
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

function handleDevUserRoleChange() {
  const rolInput = document.getElementById('devInputRol');
  const tip = document.getElementById('devStudentRoleTip');
  if (rolInput && tip) {
    tip.style.display = (rolInput.value === 'estudiante') ? 'block' : 'none';
  }
}
window.handleDevUserRoleChange = handleDevUserRoleChange;

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
  const tip = document.getElementById('devStudentRoleTip');

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
    if (tip) tip.style.display = (user.rol === 'estudiante') ? 'block' : 'none';
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
    if (tip) tip.style.display = 'none';
  }

  modal.style.display = 'flex';
  const form = document.getElementById('formDevUser');
  if (form) snapshotFormInitialValues(form);
}

function closeModalDevUser(force = false) {
  if (force && force.target && force.target.classList && force.target.classList.contains('modal-qr-backdrop')) {
    return; // Ignorar clics y arrastres sobre el fondo oscuro
  }
  const form = document.getElementById('formDevUser');
  if (force !== true && isFormDirty(form)) {
    if (!confirm('¿Deseas descartar los cambios? Hay información sin guardar en el formulario de usuario.')) {
      return;
    }
  }
  const modal = document.getElementById('modalDevUser');
  if (modal) modal.style.display = 'none';
  const tip = document.getElementById('devStudentRoleTip');
  if (tip) tip.style.display = 'none';
  if (form) form.reset();
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

    closeModalDevUser(true);
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
  const form = document.getElementById('formDevPassword');
  if (form) snapshotFormInitialValues(form);
}

function closeModalDevPassword(force = false) {
  if (force && force.target && force.target.classList && force.target.classList.contains('modal-qr-backdrop')) {
    return; // Ignorar clics y arrastres sobre el fondo oscuro
  }
  const form = document.getElementById('formDevPassword');
  if (force !== true && isFormDirty(form)) {
    if (!confirm('¿Deseas cancelar el cambio de contraseña?')) {
      return;
    }
  }
  const modal = document.getElementById('modalDevPassword');
  if (modal) modal.style.display = 'none';
  if (form) form.reset();
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

    closeModalDevPassword(true);
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
    if (cardBalVal) { cardBalVal.style.color = '#ffffff'; cardBalVal.style.textShadow = '0 1px 3px rgba(0,0,0,0.8)'; }
    if (cardBalLbl) { cardBalLbl.style.color = '#334155'; }
    if (cardBrand) { cardBrand.style.color = '#0f172a'; cardBrand.style.textShadow = '0 1px 2px rgba(255,255,255,0.8)'; }
  } else {
    if (cardName) { cardName.style.color = '#ffffff'; cardName.style.textShadow = '0 2px 8px rgba(0,0,0,0.9)'; }
    if (cardGrade) { cardGrade.style.color = '#cbd5e1'; cardGrade.style.textShadow = '0 2px 6px rgba(0,0,0,0.9)'; }
    if (cardBalVal) { cardBalVal.style.color = '#ffffff'; cardBalVal.style.textShadow = '0 1px 3px rgba(0,0,0,0.8)'; }
    if (cardBalLbl) { cardBalLbl.style.color = '#cbd5e1'; }
    if (cardBrand) { cardBrand.style.color = '#ffffff'; cardBrand.style.textShadow = '0 2px 8px rgba(0,0,0,0.8)'; }
  }
}

async function saveDevCardDesign(e) {
  e.preventDefault();
  const name = document.getElementById('devCardName').value.trim();
  const categoria = document.getElementById('devCardCategory').value;
  const estilo_texto = document.getElementById('devCardTextStyle').value;
  const isDefault = document.getElementById('devCardIsDefault')?.checked ? 1 : 0;
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
        es_predeterminado: isDefault,
        image_base64: devUploadedBase64
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar diseño');

    // Limpiar formulario
    devUploadedBase64 = null;
    document.getElementById('formDevCardDesign').reset();
    const chkDefault = document.getElementById('devCardIsDefault');
    if (chkDefault) chkDefault.checked = false;
    document.getElementById('devUploadPrompt').style.display = 'block';
    document.getElementById('devUploadSuccess').style.display = 'none';
    document.getElementById('devLiveCardBgImg').src = '/img/cards/card_robo_lab.jpg';

    if (window.sounds) window.sounds.playSuccess();
    alert('¡Diseño guardado y publicado con éxito! Ya está disponible para todos los estudiantes.');

    await loadDevDisenos();
    await loadCardDesigns();
    if (isDefault && typeof applyCardTheme === 'function' && typeof getSavedCardTheme === 'function') {
      applyCardTheme(getSavedCardTheme());
    }
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
    const isDefault = Boolean(d.es_predeterminado);

    return `
      <div style="background: var(--card-bg, #ffffff); border: ${isDefault ? '2px solid #0284c7' : '1.5px solid var(--border, #e2e8f0)'}; border-radius: 14px; overflow: hidden; box-shadow: ${isDefault ? '0 4px 14px rgba(2, 132, 199, 0.18)' : '0 2px 8px rgba(0,0,0,0.04)'}; display: flex; flex-direction: column;">
        <div style="position: relative; aspect-ratio: 1.586; overflow: hidden; background: #0f172a;">
          <img src="${escapeHtml(d.imagen_url)}" alt="${escapeHtml(d.nombre)}" style="width: 100%; height: 100%; object-fit: cover; display: block;" onerror="this.src='/img/cards/card_robo_lab.jpg'">
          <div style="position: absolute; top: 8px; left: 8px; background: rgba(15, 23, 42, 0.75); color: white; font-size: 0.68rem; font-weight: 700; padding: 2px 8px; border-radius: 6px; backdrop-filter: blur(4px);">
            ${catLabel}
          </div>
          <div style="position: absolute; top: 8px; right: 8px; display: flex; gap: 4px; align-items: center;">
            ${isDefault ? `<span style="color: #0284c7; font-weight: 800; font-size: 0.72rem; background: #e0f2fe; border: 1px solid #7dd3fc; padding: 2px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px; box-shadow: 0 2px 6px rgba(2,132,199,0.25);">★ Predeterminada</span>` : ''}
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
              ${isDefault ? '<span style="color: #0284c7; font-weight: 800; background: #f0f9ff; border: 1px solid #bae6fd; padding: 1px 6px; border-radius: 4px;">● Predeterminada</span>' : ''}
            </div>
          </div>
          <div style="margin-top: 12px; display: flex; gap: 6px; justify-content: flex-end; align-items: center; flex-wrap: wrap;">
            ${isDefault ? `
              <span class="dev-action-btn" style="padding: 5px 10px; font-size: 0.75rem; background: #f0fdf4; color: #166534; border: 1px solid #86efac; font-weight: 800; display: inline-flex; align-items: center; gap: 4px; cursor: default;" title="Esta tarjeta se asigna a todos los nuevos usuarios">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Predeterminada
              </span>
            ` : `
              <button onclick="setDevCardAsDefault(${d.id}, '${escapeHtml(d.nombre)}')" class="dev-action-btn" style="padding: 5px 10px; font-size: 0.75rem; background: #f0f9ff; color: #0284c7; border: 1px solid #bae6fd; font-weight: 800; display: inline-flex; align-items: center; gap: 4px;" title="Establecer como tarjeta predeterminada para nuevos usuarios">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> Predeterminada
              </button>
            `}
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

async function setDevCardAsDefault(id, nombre) {
  try {
    const res = await fetch(`/api/developer/disenos-tarjetas/${id}/predeterminada`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al cambiar tarjeta predeterminada');

    if (window.sounds) window.sounds.playSuccess();
    alert(`¡"${nombre}" es ahora la tarjeta predeterminada!\nTodos los nuevos usuarios creados tendrán este diseño por defecto.`);

    await loadDevDisenos();
    await loadCardDesigns();
    if (typeof applyCardTheme === 'function' && typeof getSavedCardTheme === 'function') {
      applyCardTheme(getSavedCardTheme());
    }
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    alert(`Error: ${err.message}`);
  }
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
  if (form) snapshotFormInitialValues(form);
  setTimeout(() => document.getElementById('devEscuelaCodigo')?.focus(), 50);
}

function closeModalDevEscuela(force = false) {
  if (force && force.target && force.target.classList && force.target.classList.contains('modal-qr-backdrop')) {
    return; // Ignorar clics y arrastres sobre el fondo oscuro
  }
  const form = document.getElementById('formDevEscuela');
  if (force !== true && isFormDirty(form)) {
    if (!confirm('¿Deseas salir? Hay datos de la nueva escuela sin guardar.')) {
      return;
    }
  }
  const modal = document.getElementById('modalDevEscuela');
  if (modal) modal.style.display = 'none';
  if (form) form.reset();
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

    closeModalDevEscuela(true);
    alert(`¡Éxito al dar de alta la escuela!\n\n` +
          `Sede: ${data.nombre} (${data.codigo})\n\n` +
          `Se creó el catálogo de productos y las siguientes cuentas operativas:\n` +
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

// ==========================================
// GESTIÓN DE COPIAS DE SEGURIDAD (DEVELOPER)
// ==========================================
async function cargarBackupsDev() {
  const tbody = document.getElementById('devBackupsTableBody');
  if (!tbody) return;

  try {
    const res = await fetch('/api/developer/backups');
    const data = await res.json();
    const backups = data.backups || [];

    if (backups.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 18px; color: var(--text-muted);">No hay respaldos generados aún. Haz clic en "Crear Respaldo Ahora".</td></tr>`;
      return;
    }

    tbody.innerHTML = backups.map(b => {
      const fechaFmt = b.fecha ? new Date(b.fecha).toLocaleString('es-CR') : '-';
      const badgeColor = b.tipo === 'PostgreSQL' ? '#0284c7' : '#16a34a';
      return `
        <tr style="border-bottom: 1px solid var(--border);">
          <td style="padding: 10px 12px; font-weight: 800; color: var(--text-main); font-family: monospace;">
            💾 ${escapeHtml(b.filename)}
          </td>
          <td style="padding: 10px 12px;">
            <span style="font-size: 0.70rem; font-weight: 800; padding: 2px 7px; border-radius: 6px; background: rgba(2, 132, 199, 0.1); color: ${badgeColor};">
              ${escapeHtml(b.tipo)}
            </span>
          </td>
          <td style="padding: 10px 12px; color: var(--text-muted); font-size: 0.78rem;">
            ${fechaFmt}
          </td>
          <td style="padding: 10px 12px; font-weight: 800; color: #16a34a;">
            ${escapeHtml(b.sizeFmt)}
          </td>
          <td style="padding: 10px 12px; text-align: right;">
            <button type="button" onclick="descargarBackupDev('${encodeURIComponent(b.filename)}')" class="dev-action-btn" style="padding: 5px 12px; font-size: 0.76rem; display: inline-flex; align-items: center; gap: 4px;">
              <span>⬇️ Descargar</span>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 18px; color: #dc2626;">Error al cargar lista de respaldos: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function ejecutarBackupManualDev() {
  const btn = document.getElementById('btnDevCrearBackup');
  const msg = document.getElementById('devBackupsStatusMsg');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳ Generando Respaldo...';
  }
  if (msg) msg.style.display = 'none';

  try {
    const res = await fetch('/api/developer/backups/crear', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error generando respaldo');

    if (window.sounds) window.sounds.playSuccess();
    if (msg) {
      msg.style.display = 'block';
      msg.style.background = '#f0fdf4';
      msg.style.border = '1px solid #bbf7d0';
      msg.style.color = '#166534';
      msg.textContent = `✅ ${data.mensaje}`;
    }
    cargarBackupsDev();
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    if (msg) {
      msg.style.display = 'block';
      msg.style.background = '#fef2f2';
      msg.style.border = '1px solid #fecaca';
      msg.style.color = '#991b1b';
      msg.textContent = `❌ ${err.message}`;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> <span>Crear Respaldo Ahora</span>`;
    }
  }
}

function descargarBackupDev(filename) {
  window.location.href = `/api/developer/backups/descargar/${filename}`;
}
window.descargarBackupDev = descargarBackupDev;
window.cargarBackupsDev = cargarBackupsDev;
window.ejecutarBackupManualDev = ejecutarBackupManualDev;

// ==========================================
// VISOR DE LOGS DEL SERVIDOR Y TERMINAL WEB EN VIVO (DEVELOPER)
// ==========================================
let devLogsEventSource = null;
let devLogsList = [];
let devLogsFilter = 'all';
let devLogsSearchQuery = '';
let devLogsPaused = false;

async function initDevLogsTerminal() {
  const screen = document.getElementById('devTerminalScreen');
  if (!screen) return;

  // Cargar datos iniciales
  try {
    const res = await fetch('/api/developer/logs?limit=300');
    if (!res.ok) throw new Error('Error al consultar logs');
    const data = await res.json();
    
    devLogsList = data.logs || [];
    actualizarTelemetriaTerminal(data);
    renderizarDevLogsPantalla();
  } catch (err) {
    if (screen) {
      screen.innerHTML = `<div style="color: #f87171; padding: 10px;">❌ Error al conectar con el servicio de logs: ${escapeHtml(err.message)}</div>`;
    }
  }

  // Conectar SSE en vivo si no está abierto
  conectarStreamLogsEnVivo();
}

function conectarStreamLogsEnVivo() {
  if (devLogsEventSource && devLogsEventSource.readyState !== EventSource.CLOSED) {
    return;
  }

  try {
    devLogsEventSource = new EventSource('/api/developer/logs/stream');

    devLogsEventSource.addEventListener('server_log', (e) => {
      if (devLogsPaused) return;
      try {
        const logEntry = JSON.parse(e.data);
        devLogsList.push(logEntry);
        if (devLogsList.length > 800) devLogsList.shift();

        if (logCumpleFiltros(logEntry)) {
          appendLogLineToScreen(logEntry);
        }
        actualizarContadorLineas();
      } catch (err) {
        console.error('Error parseando server_log:', err);
      }
    });

    devLogsEventSource.addEventListener('handshake', () => {
      actualizarEstadoBadgeTerminal(true);
    });

    devLogsEventSource.onerror = () => {
      actualizarEstadoBadgeTerminal(false);
    };

    devLogsEventSource.onopen = () => {
      actualizarEstadoBadgeTerminal(true);
    };
  } catch (err) {
    console.error('Error iniciando SSE de logs:', err);
  }
}

function logCumpleFiltros(log) {
  if (devLogsFilter !== 'all') {
    const filter = devLogsFilter.toLowerCase();
    const level = (log.level || '').toLowerCase();
    const tag = (log.tag || '').toLowerCase();

    if (filter === 'auth') {
      if (tag !== 'auth' && tag !== 'seguridad') return false;
    } else if (filter === 'orden') {
      if (tag !== 'orden' && tag !== 'soda') return false;
    } else if (filter === 'sinpe' || filter === 'finanzas') {
      if (tag !== 'sinpe' && tag !== 'recarga' && tag !== 'transfer' && tag !== 'transferencia') return false;
    } else if (filter === 'sistema') {
      if (tag !== 'sistema' && tag !== 'cron' && tag !== 'pm2' && tag !== 'pistola' && tag !== 'webpush') return false;
    } else {
      const levelMatch = level === filter;
      const tagMatch = tag === filter;
      if (!levelMatch && !tagMatch) return false;
    }
  }
  if (devLogsSearchQuery) {
    const q = devLogsSearchQuery.toLowerCase();
    const msgMatch = (log.message || '').toLowerCase().includes(q);
    const tagMatch = (log.tag || '').toLowerCase().includes(q);
    if (!msgMatch && !tagMatch) return false;
  }
  return true;
}

function renderizarDevLogsPantalla() {
  const screen = document.getElementById('devTerminalScreen');
  if (!screen) return;

  const filtrados = devLogsList.filter(logCumpleFiltros);
  if (filtrados.length === 0) {
    screen.innerHTML = `<div style="color: #64748b; font-style: italic; padding: 12px 6px;">No hay eventos registrados que coincidan con los filtros actuales.</div>`;
    actualizarContadorLineas(0);
    return;
  }

  screen.innerHTML = filtrados.map(crearHtmlLineaLog).join('');
  actualizarContadorLineas(filtrados.length);

  const autoScrollCheck = document.getElementById('devTermAutoScrollCheck');
  if (autoScrollCheck && autoScrollCheck.checked) {
    screen.scrollTop = screen.scrollHeight;
  }
}

function appendLogLineToScreen(log) {
  const screen = document.getElementById('devTerminalScreen');
  if (!screen) return;

  const temp = document.createElement('div');
  temp.innerHTML = crearHtmlLineaLog(log);
  const row = temp.firstElementChild;
  if (row) {
    screen.appendChild(row);
  }

  const autoScrollCheck = document.getElementById('devTermAutoScrollCheck');
  if (autoScrollCheck && autoScrollCheck.checked) {
    screen.scrollTop = screen.scrollHeight;
  }
}

function crearHtmlLineaLog(log) {
  const tagClass = getTagCssClass(log.tag, log.level);
  const levelRowClass = log.level === 'error' ? 'log-level-error' : (log.level === 'warn' ? 'log-level-warn' : '');
  
  let msgFormatted = escapeHtml(log.message || '');
  msgFormatted = msgFormatted
    .replace(/\b(GET)\b/g, '<span style="color: #38bdf8; font-weight: 800;">GET</span>')
    .replace(/\b(POST)\b/g, '<span style="color: #34d399; font-weight: 800;">POST</span>')
    .replace(/\b(PUT)\b/g, '<span style="color: #c084fc; font-weight: 800;">PUT</span>')
    .replace(/\b(DELETE)\b/g, '<span style="color: #f87171; font-weight: 800;">DELETE</span>')
    .replace(/\b(200|201)\b/g, '<span style="color: #4ade80; font-weight: 700;">$1</span>')
    .replace(/\b(400|401|403|404)\b/g, '<span style="color: #fbbf24; font-weight: 700;">$1</span>')
    .replace(/\b(500|502|503)\b/g, '<span style="color: #ef4444; font-weight: 800;">$1</span>');

  return `
    <div class="dev-log-line ${levelRowClass}">
      <span class="dev-log-time">[${escapeHtml(log.timestamp || '')}]</span>
      <span class="dev-log-tag ${tagClass}">${escapeHtml(log.tag || 'APP')}</span>
      <span class="dev-log-msg">${msgFormatted}</span>
    </div>
  `;
}

function getTagCssClass(tag, level) {
  const t = (tag || '').toLowerCase();
  const lvl = (level || '').toLowerCase();
  if (lvl === 'error' || t === 'error') return 'tag-error';
  if (lvl === 'warn' || t === 'warn') return 'tag-warn';
  if (t === 'http') return 'tag-http';
  if (t === 'sinpe' || t === 'recarga' || t === 'transfer' || t === 'transferencia') return 'tag-sinpe';
  if (t === 'auth' || t === 'seguridad') return 'tag-auth';
  if (t === 'orden' || t === 'soda') return 'tag-orden';
  if (t === 'sistema' || t === 'pm2' || t === 'cron') return 'tag-sistema';
  return 'tag-app';
}

function setDevLogsFilter(filter, btn) {
  devLogsFilter = filter;
  document.querySelectorAll('.dev-terminal-filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderizarDevLogsPantalla();
}

function applyDevLogsSearch() {
  const input = document.getElementById('devTermSearchInput');
  devLogsSearchQuery = input ? input.value : '';
  renderizarDevLogsPantalla();
}

function toggleDevLogsPause() {
  devLogsPaused = !devLogsPaused;
  const icon = document.getElementById('devLogsPauseIcon');
  const text = document.getElementById('devLogsPauseText');
  const badge = document.getElementById('devTermStatusBadge');

  if (devLogsPaused) {
    if (icon) icon.textContent = '▶';
    if (text) text.textContent = 'Reanudar Flujo';
    if (badge) {
      badge.className = 'dev-terminal-badge-live paused';
      badge.innerHTML = '<span class="pulse-dot"></span> PAUSADO';
    }
  } else {
    if (icon) icon.textContent = '⏸';
    if (text) text.textContent = 'Pausar Flujo';
    if (badge) {
      badge.className = 'dev-terminal-badge-live';
      badge.innerHTML = '<span class="pulse-dot"></span> EN VIVO';
    }
    initDevLogsTerminal();
  }
}

async function clearDevTerminalScreen() {
  devLogsList = [];
  const screen = document.getElementById('devTerminalScreen');
  if (screen) {
    screen.innerHTML = '<div style="color: #64748b; font-style: italic; padding: 12px 6px;">Pantalla de terminal limpiada. Esperando nuevos eventos...</div>';
  }
  actualizarContadorLineas(0);
  try {
    await fetch('/api/developer/logs/clear', { method: 'POST' });
  } catch (e) {}
}

function descargarDevLogs() {
  if (devLogsList.length === 0) {
    if (typeof showToast === 'function') {
      showToast('No hay registros en la terminal para descargar.', 'warning');
    } else {
      alert('No hay registros en la terminal para descargar.');
    }
    return;
  }

  const lineas = devLogsList.map(l => `[${l.timestamp}] [${l.tag}] ${l.message}`);
  const contenido = lineas.join('\n');
  const blob = new Blob([contenido], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const now = new Date();
  const fechaStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}`;
  a.href = url;
  a.download = `sibopay-server-logs-${fechaStr}.log`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 200);
}

function actualizarTelemetriaTerminal(data) {
  const uptimeLbl = document.getElementById('devTermUptimeLabel');
  const memLbl = document.getElementById('devTermMemMb');
  const nodeLbl = document.getElementById('devTermNodeVer');

  if (data && data.uptimeSeconds !== undefined && uptimeLbl) {
    const d = Math.floor(data.uptimeSeconds / 86400);
    const h = Math.floor((data.uptimeSeconds % 86400) / 3600);
    const m = Math.floor((data.uptimeSeconds % 3600) / 60);
    const s = data.uptimeSeconds % 60;
    uptimeLbl.textContent = `Uptime: ${d > 0 ? d + 'd ' : ''}${h}h ${m}m ${s}s`;
  }
  if (data && data.memoryMb && memLbl) memLbl.textContent = `${data.memoryMb} MB`;
  if (data && data.nodeVersion && nodeLbl) nodeLbl.textContent = data.nodeVersion;
}

function actualizarContadorLineas(num) {
  const lbl = document.getElementById('devTermLineCount');
  if (lbl) {
    lbl.textContent = String(num !== undefined ? num : devLogsList.length);
  }
}

function actualizarEstadoBadgeTerminal(conectado) {
  const badge = document.getElementById('devTermStatusBadge');
  if (!badge) return;
  if (devLogsPaused) return;

  if (conectado) {
    badge.className = 'dev-terminal-badge-live';
    badge.innerHTML = '<span class="pulse-dot"></span> EN VIVO';
  } else {
    badge.className = 'dev-terminal-badge-live paused';
    badge.innerHTML = '<span class="pulse-dot"></span> RECONECTANDO...';
  }
}

window.initDevLogsTerminal = initDevLogsTerminal;
window.setDevLogsFilter = setDevLogsFilter;
window.applyDevLogsSearch = applyDevLogsSearch;
window.toggleDevLogsPause = toggleDevLogsPause;
window.clearDevTerminalScreen = clearDevTerminalScreen;
window.descargarDevLogs = descargarDevLogs;

// ==========================================
// DESCARGA DIRECTA DE ARCHIVOS (ANTI POPUP-BLOCKER)
// ==========================================
async function descargarArchivoDirecto(url, defaultFilename) {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`El servidor respondió con código ${res.status}`);
    }
    const blob = await res.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = defaultFilename || 'reporte.xlsx';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      if (link.parentNode) link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    }, 250);
  } catch (err) {
    console.error('Error al descargar archivo blob, usando fallback directo:', err);
    const link = document.createElement('a');
    link.href = url;
    link.download = defaultFilename || 'reporte.xlsx';
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      if (link.parentNode) link.parentNode.removeChild(link);
    }, 250);
  }
}
window.descargarArchivoDirecto = descargarArchivoDirecto;

// ==========================================
// CARGA MASIVA DE ESTUDIANTES (DEVELOPER)
// ==========================================
let parsedStudentsToImport = [];

async function cargarEscuelasSelectImportacion() {
  const select = document.getElementById('devImportEscuelaSelect');
  if (!select) return;

  try {
    const res = await fetch('/api/developer/escuelas');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const escuelas = await res.json();
    if (Array.isArray(escuelas) && escuelas.length > 0) {
      select.innerHTML = escuelas.map(e => `
        <option value="${e.id}">${escapeHtml(e.nombre)} (${escapeHtml(e.codigo || 'Sede')})</option>
      `).join('');
    } else {
      select.innerHTML = '<option value="1">Soda Escolar Central (ESC01)</option>';
    }
  } catch (err) {
    console.error('Error cargando escuelas para importación:', err);
    if (select.children.length === 0) {
      select.innerHTML = '<option value="1">Soda Escolar Central (ESC01)</option>';
    }
  }
}
window.cargarEscuelasSelectImportacion = cargarEscuelasSelectImportacion;

function cargarEjemploImportacionDev() {
  const txt = document.getElementById('devImportTextarea');
  if (!txt) return;
  txt.value = `Nombre Completo\tGrado\tSección\tSaldo Inicial\tAlergias\tTeléfono Padre
Santiago Morales Castro\t5to\t5-B\t3000\tLactosa\t8888-1234
Valeria Solano Gómez\t3ro\t3-A\t5000\tNinguna\t8765-4321
Mateo Alvarado Pérez\t2do\t2-A\t1500\tManí\t8333-2211`;
  analizarDatosImportacionDev();
}
window.cargarEjemploImportacionDev = cargarEjemploImportacionDev;

function descargarPlantillaCsvEstudiantes() {
  const headers = ['Nombre Completo', 'Grado', 'Seccion', 'Saldo Inicial', 'Alergias', 'Telefono Padre'];
  const sampleRows = [
    ['Santiago Morales Castro', '5to', '5-B', '3000', 'Lactosa', '8888-1234'],
    ['Valeria Solano Gómez', '3ro', '3-A', '5000', 'Ninguna', '8765-4321'],
    ['Mateo Alvarado Pérez', '2do', '2-A', '1500', 'Maní', '8333-2211']
  ];
  const csvContent = '\uFEFF' + [headers.join(','), ...sampleRows.map(r => r.map(c => `"${c}"`).join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'plantilla_estudiantes_sibopay.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    if (a.parentNode) a.parentNode.removeChild(a);
    URL.revokeObjectURL(url);
  }, 250);
}
window.descargarPlantillaCsvEstudiantes = descargarPlantillaCsvEstudiantes;

function handleDevImportFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const content = e.target.result;
    const txt = document.getElementById('devImportTextarea');
    if (txt) {
      txt.value = content;
      analizarDatosImportacionDev();
    }
  };
  reader.readAsText(file);
}
window.handleDevImportFile = handleDevImportFile;

function analizarDatosImportacionDev() {
  const textarea = document.getElementById('devImportTextarea');
  const previewBox = document.getElementById('devImportPreviewBox');
  const tbody = document.getElementById('devImportPreviewTbody');
  const countBadge = document.getElementById('devImportPreviewCount');
  const resultMsg = document.getElementById('devImportResultMsg');
  if (resultMsg) resultMsg.style.display = 'none';

  if (!textarea || !textarea.value.trim()) {
    alert('Por favor, pega datos de Excel o escribe el listado de alumnos.');
    return;
  }

  const rawLines = textarea.value.trim().split(/\r?\n/);
  parsedStudentsToImport = [];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    if (!line) continue;

    let delimiter = '\t';
    if (line.includes('\t')) delimiter = '\t';
    else if (line.includes(';')) delimiter = ';';
    else if (line.includes(',')) delimiter = ',';

    const cols = line.split(delimiter).map(c => c.trim().replace(/^["']|["']$/g, ''));
    if (cols.length === 0 || !cols[0]) continue;

    // Saltar encabezados
    const firstColLower = (cols[0] || '').toLowerCase();
    const secondColLower = (cols[1] || '').toLowerCase();
    if (i === 0 && (firstColLower.includes('nombre') || firstColLower.includes('alumno') || firstColLower.includes('estudiante') || secondColLower.includes('nombre'))) {
      continue;
    }

    // Detectar si la primera columna es un número secuencial (1, 2, 3...)
    let offset = 0;
    if (cols.length > 1 && /^\d+$/.test(cols[0]) && isNaN(cols[1])) {
      offset = 1;
    }

    const nombre = cols[offset + 0] || '';
    if (!nombre || nombre.length < 2) continue;

    const grado = cols[offset + 1] || 'General';
    const seccion = cols[offset + 2] || 'A';
    const saldoRaw = String(cols[offset + 3] || '0').replace(/[^\d]/g, '');
    const saldo = parseInt(saldoRaw, 10) || 0;
    const alergias = cols[offset + 4] || 'Ninguna conocida';
    const tel = cols[offset + 5] || '';

    parsedStudentsToImport.push({
      nombre_completo: nombre,
      grado: grado,
      seccion: seccion,
      saldo_inicial: saldo,
      alergias: alergias,
      padre_telefono: tel
    });
  }

  if (parsedStudentsToImport.length === 0) {
    alert('No se detectaron alumnos válidos en el texto ingresado. Asegúrate de incluir al menos los nombres de los estudiantes.');
    return;
  }

  if (countBadge) countBadge.textContent = `${parsedStudentsToImport.length} Alumnos Detectados`;
  if (tbody) {
    tbody.innerHTML = parsedStudentsToImport.map((st, idx) => `
      <tr style="border-bottom: 1px solid var(--border);">
        <td style="padding: 6px 10px; color: var(--text-muted);">${idx + 1}</td>
        <td style="padding: 6px 10px; font-weight: 800; color: var(--text-main);">${escapeHtml(st.nombre_completo)}</td>
        <td style="padding: 6px 10px;">${escapeHtml(st.grado)} - ${escapeHtml(st.seccion)}</td>
        <td style="padding: 6px 10px; color: #16a34a; font-weight: 700;">₡${st.saldo_inicial.toLocaleString('es-CR')}</td>
        <td style="padding: 6px 10px; color: ${st.alergias !== 'Ninguna conocida' ? '#e11d48' : 'var(--text-muted)'}; font-size: 0.76rem;">${escapeHtml(st.alergias)}</td>
        <td style="padding: 6px 10px; font-family: monospace;">${escapeHtml(st.padre_telefono || '-')}</td>
        <td style="padding: 6px 10px; color: #0284c7; font-size: 0.76rem; font-weight: 700;">(Auto-generado)</td>
      </tr>
    `).join('');
  }

  if (previewBox) {
    previewBox.style.display = 'block';
    try { previewBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
  }
}
window.analizarDatosImportacionDev = analizarDatosImportacionDev;

async function ejecutarImportacionMasivaDev() {
  if (!parsedStudentsToImport || parsedStudentsToImport.length === 0) {
    alert('Primero analiza y previsualiza los estudiantes a importar.');
    return;
  }

  const select = document.getElementById('devImportEscuelaSelect');
  const escuelaId = select ? parseInt(select.value, 10) : 1;
  const btn = document.getElementById('btnDevEjecutarImport');
  const resultMsg = document.getElementById('devImportResultMsg');

  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Importando en la Base de Datos...';
  }

  try {
    const res = await fetch('/api/developer/estudiantes/importar-masivo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        escuela_id: escuelaId,
        estudiantes: parsedStudentsToImport
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al procesar la importación.');

    if (window.sounds) {
      window.sounds.playSuccess();
      window.sounds.playCoin();
    }

    if (resultMsg) {
      resultMsg.style.display = 'block';
      resultMsg.style.background = '#f0fdf4';
      resultMsg.style.border = '1.5px solid #86efac';
      resultMsg.style.color = '#166534';
      resultMsg.innerHTML = `
        <strong>${data.mensaje}</strong>
        <div style="font-size: 0.78rem; margin-top: 6px;">Total procesados: ${data.totalProcesados} · Insertados con éxito: ${data.insertados} · Omitidos: ${data.omitidos}</div>
        ${data.errores && data.errores.length > 0 ? `<div style="color: #dc2626; font-size: 0.74rem; margin-top: 4px;">Avisos: ${data.errores.join(' | ')}</div>` : ''}
      `;
    }

    const previewBox = document.getElementById('devImportPreviewBox');
    if (previewBox) previewBox.style.display = 'none';
    const txt = document.getElementById('devImportTextarea');
    if (txt) txt.value = '';
    parsedStudentsToImport = [];

    // Recargar usuarios/estudiantes en las demás vistas
    if (typeof loadDevUsuarios === 'function') loadDevUsuarios();
    if (typeof loadAdminData === 'function') loadAdminData();

  } catch (err) {
    if (window.sounds) window.sounds.playError();
    if (resultMsg) {
      resultMsg.style.display = 'block';
      resultMsg.style.background = '#fef2f2';
      resultMsg.style.border = '1.5px solid #fecaca';
      resultMsg.style.color = '#991b1b';
      resultMsg.innerHTML = `<strong>Error durante la importación:</strong> ${err.message}`;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '⚡ Confirmar e Importar Todos los Estudiantes';
    }
  }
}
window.ejecutarImportacionMasivaDev = ejecutarImportacionMasivaDev;

// ==========================================
// EXPORTACIÓN A EXCEL / CSV (ADMIN SODA)
// ==========================================
async function exportarVentasCsv() {
  const btn = document.querySelector('[onclick*="exportarVentasCsv"]');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>⏳ Generando...</span>';
  }
  try {
    const escuelaId = (currentUser && currentUser.escuela_id) || '';
    const url = `/api/admin/export/ventas.xlsx${escuelaId ? '?escuela_id=' + escuelaId : ''}`;
    await descargarArchivoDirecto(url, `ventas_sibopay_${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (err) {
    alert('Error al exportar ventas: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}
window.exportarVentasCsv = exportarVentasCsv;

async function exportarEstudiantesCsv() {
  const btn = document.querySelector('[onclick*="exportarEstudiantesCsv"]');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>⏳ Generando...</span>';
  }
  try {
    const escuelaId = (currentUser && currentUser.escuela_id) || '';
    const url = `/api/admin/export/estudiantes.xlsx${escuelaId ? '?escuela_id=' + escuelaId : ''}`;
    await descargarArchivoDirecto(url, `estudiantes_saldos_sibopay_${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (err) {
    alert('Error al exportar estudiantes: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}
window.exportarEstudiantesCsv = exportarEstudiantesCsv;

// Exportación global para eventos de la interfaz de login moderna
window.openLoginSheet = openLoginSheet;
window.closeLoginSheet = closeLoginSheet;
window.switchSheetView = switchSheetView;
window.openTerminosModal = openTerminosModal;
window.closeTerminosModal = closeTerminosModal;

// ========================================================
// AJUSTES DE CUENTA, PRIVACIDAD Y EXPERIENCIA SENSORIAL HÁPTICA
// ========================================================
function abrirModalAjustesCuenta() {
  const modal = document.getElementById('modalAjustesCuenta');
  if (!modal) return;

  const lblNombre = document.getElementById('ajustesCuentaNombre');
  const lblRol = document.getElementById('ajustesCuentaRol');
  const chkSound = document.getElementById('chkAjustesSound');
  const chkHaptic = document.getElementById('chkAjustesHaptic');

  let user = currentUser;
  if (!user) {
    try {
      const raw = localStorage.getItem('sibopay_user') || localStorage.getItem('recreopay_user');
      if (raw) user = JSON.parse(raw);
    } catch (_) {}
  }

  if (user) {
    if (lblNombre) lblNombre.textContent = user.nombre || user.username || (currentStudent && currentStudent.nombre_completo) || 'Usuario';
    if (lblRol) {
      let r = user.rol || 'Usuario';
      if (r === 'padre') r = 'Padre / Encargado';
      else if (r === 'estudiante') r = 'Estudiante / Alumno';
      else if (r === 'cajero') r = 'Cajero de Soda';
      else if (r === 'admin') r = 'Administrador de Soda';
      lblRol.textContent = r;
    }
  } else if (currentStudent) {
    if (lblNombre) lblNombre.textContent = currentStudent.nombre_completo || 'Estudiante';
    if (lblRol) lblRol.textContent = 'Estudiante / Alumno';
  }

  try {
    if (chkSound && window.sounds && typeof window.sounds.isSoundEnabled === 'function') {
      chkSound.checked = window.sounds.isSoundEnabled();
    }
    if (chkHaptic && window.sounds && typeof window.sounds.isHapticEnabled === 'function') {
      chkHaptic.checked = window.sounds.isHapticEnabled();
    }
  } catch (_) {}

  modal.style.display = 'flex';
  modal.style.zIndex = '10005';
}
window.abrirModalAjustesCuenta = abrirModalAjustesCuenta;

function cerrarModalAjustesCuenta(e) {
  if (e && e.target !== e.currentTarget && e.currentTarget !== document) return;
  const modal = document.getElementById('modalAjustesCuenta');
  if (modal) modal.style.display = 'none';
}
window.cerrarModalAjustesCuenta = cerrarModalAjustesCuenta;

function toggleSensorySoundUI(checked) {
  if (window.sounds) {
    window.sounds.toggleSound(checked);
  }
}
window.toggleSensorySoundUI = toggleSensorySoundUI;

function toggleSensoryHapticUI(checked) {
  if (window.sounds) {
    window.sounds.toggleHaptics(checked);
  }
}
window.toggleSensoryHapticUI = toggleSensoryHapticUI;

function abrirModalConfirmarEliminarCuenta() {
  cerrarModalAjustesCuenta();
  const modal = document.getElementById('modalConfirmarEliminarCuenta');
  const input = document.getElementById('inputConfirmarPassEliminar');
  if (input) input.value = '';
  if (modal) modal.style.display = 'flex';
}
window.abrirModalConfirmarEliminarCuenta = abrirModalConfirmarEliminarCuenta;

function cerrarModalConfirmarEliminarCuenta(e) {
  if (e && e.target !== e.currentTarget && e.currentTarget !== document) return;
  const modal = document.getElementById('modalConfirmarEliminarCuenta');
  if (modal) modal.style.display = 'none';
}
window.cerrarModalConfirmarEliminarCuenta = cerrarModalConfirmarEliminarCuenta;

async function confirmarEliminarCuentaDefinitiva() {
  if (!currentUser || !currentUser.id) {
    alert('No hay una sesión activa para eliminar.');
    return;
  }

  const input = document.getElementById('inputConfirmarPassEliminar');
  const val = input ? input.value.trim() : '';

  if (!val) {
    alert('Por favor ingresa tu contraseña o la palabra ELIMINAR para verificar tu identidad.');
    return;
  }

  const btn = document.getElementById('btnEjecutarEliminacionDefinitiva');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Eliminando cuenta...';
  }

  try {
    const res = await fetch('/api/auth/eliminar-cuenta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usuario_id: currentUser.id,
        password_confirmacion: val,
        motivo: 'Eliminación voluntaria solicitada por el usuario desde la app'
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo eliminar la cuenta');

    if (window.sounds) {
      window.sounds.playSuccess();
    }

    alert('Tu cuenta y datos personales han sido eliminados permanentemente de SiboPay.');

    // Limpieza total de almacenamiento local y caches
    try {
      localStorage.removeItem('sibopay_token');
      localStorage.removeItem('sibopay_user');
      localStorage.removeItem('recreopay_token');
      localStorage.removeItem('recreopay_user');
      sessionStorage.clear();
      if ('caches' in window) {
        const keys = await caches.keys();
        for (const k of keys) await caches.delete(k);
      }
    } catch (e) {}

    window.location.href = '/index.html';
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    alert('Error al eliminar cuenta: ' + err.message);
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Sí, Borrar Mi Cuenta';
    }
  }
}
window.confirmarEliminarCuentaDefinitiva = confirmarEliminarCuentaDefinitiva;

// ========================================================
// RETROALIMENTACIÓN HÁPTICA GLOBAL EN DISPOSITIVOS MÓVILES
// ========================================================
let lastGlobalHapticTapTime = 0;
function triggerGlobalHapticFeedback(e) {
  const now = Date.now();
  if (now - lastGlobalHapticTapTime < 80) return;
  const btn = e.target.closest('button, .btn-saas, .mode-btn, .login-submit-btn, .pwa-nav-item, .limit-preset-pill, .quick-amount-pill, .theme-toggle-btn, .card-design-toggle-btn, .qr-toggle-btn, .parent-nav-box, .parent-child-card');
  if (btn && !btn.disabled) {
    lastGlobalHapticTapTime = now;
    if (window.haptics && typeof window.haptics.tap === 'function') {
      window.haptics.tap();
    } else if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try { navigator.vibrate(28); } catch (err) {}
    }
  }
}
document.addEventListener('touchstart', triggerGlobalHapticFeedback, { passive: true });
document.addEventListener('pointerdown', triggerGlobalHapticFeedback, { passive: true });

// ========================================================
// BUSCADOR UNIVERSAL SINPE MÓVIL Y AUDITORÍA MASTER (DEVELOPER)
// ========================================================

let currentDevSinpeItems = [];
let devSinpeSearchTimer = null;
let currentDevSinpeSelectedItem = null;
let devCachedEstudiantesList = [];
let currentVincularBancoItem = null;

/**
 * Carga y actualiza los datos del Buscador Universal de SINPE Móvil
 */
async function loadDevSinpeUniversal() {
  const tbody = document.getElementById('devSinpeTableBody');
  const countBadge = document.getElementById('devSinpeResultCountBadge');
  const pendingBadge = document.getElementById('devSinpePendingBadge');

  const q = (document.getElementById('devSinpeSearchInput')?.value || '').trim();
  const estado = document.getElementById('devSinpeFilterEstado')?.value || 'todas';
  const escuelaId = document.getElementById('devSinpeFilterEscuela')?.value || 'todas';
  const fecha = document.getElementById('devSinpeFilterFecha')?.value || 'todas';
  const origen = document.getElementById('devSinpeFilterOrigen')?.value || 'todas';

  // Mostrar / ocultar botón limpiar
  const btnClear = document.getElementById('btnDevSinpeClearSearch');
  if (btnClear) btnClear.style.display = q ? 'block' : 'none';

  // Poblar select de escuelas si aún no tiene las opciones cargadas
  await poblarSelectEscuelasSinpeDev();

  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 35px; color: var(--text-muted);">
          <div style="display: inline-flex; align-items: center; gap: 8px;">
            <svg class="spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            <span style="font-weight: 700;">Consultando transacciones SINPE en tiempo real...</span>
          </div>
        </td>
      </tr>
    `;
  }

  try {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (estado !== 'todas') params.set('estado', estado);
    if (escuelaId !== 'todas') params.set('escuela_id', escuelaId);
    if (fecha !== 'todas') params.set('fecha', fecha);
    if (origen !== 'todas') params.set('origen', origen);

    const res = await fetch(`/api/developer/sinpe/buscar?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al consultar transacciones');

    // 1. Actualizar KPIs de la cabecera
    const kpiMonto = document.getElementById('devSinpeKpiTotalMonto');
    const kpiCant = document.getElementById('devSinpeKpiTotalCant');
    const kpiPend = document.getElementById('devSinpeKpiPendientes');
    const kpiRech = document.getElementById('devSinpeKpiRechazadas');
    const kpiBancoUncl = document.getElementById('devSinpeKpiBancoUnclaimed');
    const kpiBancoUnclMonto = document.getElementById('devSinpeKpiBancoUnclaimedMonto');

    if (kpiMonto) kpiMonto.textContent = `₡${Number(data.resumen?.total_acreditado_sinpe || 0).toLocaleString('es-CR')}`;
    if (kpiCant) kpiCant.textContent = `${data.resumen?.total_recargas_count || 0} recargas verificadas`;
    if (kpiPend) kpiPend.textContent = data.resumen?.total_pendientes_count || 0;
    if (kpiRech) kpiRech.textContent = data.resumen?.total_rechazadas_count || 0;
    if (kpiBancoUncl) kpiBancoUncl.textContent = data.resumen?.total_banco_unclaimed_count || 0;
    if (kpiBancoUnclMonto) kpiBancoUnclMonto.textContent = `₡${Number(data.resumen?.total_banco_unclaimed_monto || 0).toLocaleString('es-CR')} en depósitos huérfanos`;

    // Badge en la pestaña superior
    if (pendingBadge) {
      const numPend = data.resumen?.total_pendientes_count || 0;
      pendingBadge.textContent = numPend;
      pendingBadge.style.display = numPend > 0 ? 'inline-block' : 'none';
    }

    currentDevSinpeItems = data.resultados || [];
    if (countBadge) countBadge.textContent = `${currentDevSinpeItems.length} registros`;

    renderDevSinpeTable(currentDevSinpeItems);
  } catch (err) {
    console.error('Error al cargar SINPE dev:', err);
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 25px; color: #ef4444; font-weight: 700;">
            ⚠️ Error al cargar transacciones: ${err.message}
          </td>
        </tr>
      `;
    }
  }
}
window.loadDevSinpeUniversal = loadDevSinpeUniversal;

/**
 * Renderiza las filas de la tabla de resultados SINPE
 */
function renderDevSinpeTable(items) {
  const tbody = document.getElementById('devSinpeTableBody');
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
          <div style="font-size: 2.2rem; margin-bottom: 8px;">🔍</div>
          <div style="font-weight: 800; font-size: 1rem; color: var(--text-main);">No se encontraron transacciones SINPE</div>
          <p style="font-size: 0.82rem; margin: 4px 0 0; color: var(--text-muted);">Intenta ajustar los términos de búsqueda o cambiar los filtros de estado/fecha.</p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = items.map(item => {
    // Formatear Fecha
    let fechaStr = 'N/A';
    if (item.fecha) {
      try {
        const d = new Date(item.fecha);
        fechaStr = d.toLocaleDateString('es-CR', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
          ' ' + d.toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit', hour12: true });
      } catch (e) {
        fechaStr = String(item.fecha);
      }
    }

    // Badge de Origen
    let origenBadge = '';
    if (item.origen === 'solicitud') {
      origenBadge = `<span style="background: #f0f9ff; color: #0284c7; border: 1px solid #bae6fd; font-size: 0.70rem; font-weight: 800; padding: 2px 7px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;">📱 Solicitud App</span>`;
    } else if (item.origen === 'banco') {
      origenBadge = `<span style="background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; font-size: 0.70rem; font-weight: 800; padding: 2px 7px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;">🏦 Banco Notif.</span>`;
    } else {
      origenBadge = `<span style="background: #f8fafc; color: #475569; border: 1px solid #cbd5e1; font-size: 0.70rem; font-weight: 800; padding: 2px 7px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;">💳 Saldo Directo</span>`;
    }

    // Badge de Estado
    let estadoBadge = '';
    if (item.estado === 'aprobada' || item.estado === 'used') {
      estadoBadge = `<span style="background: #dcfce7; color: #15803d; border: 1px solid #86efac; font-size: 0.74rem; font-weight: 900; padding: 3px 9px; border-radius: 8px; display: inline-flex; align-items: center; gap: 4px;">✓ Aprobada</span>`;
    } else if (item.estado === 'pendiente') {
      estadoBadge = `<span style="background: #fef3c7; color: #b45309; border: 1px solid #fde68a; font-size: 0.74rem; font-weight: 900; padding: 3px 9px; border-radius: 8px; display: inline-flex; align-items: center; gap: 4px;">⏳ Pendiente</span>`;
    } else if (item.estado === 'rechazada') {
      estadoBadge = `<span style="background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; font-size: 0.74rem; font-weight: 900; padding: 3px 9px; border-radius: 8px; display: inline-flex; align-items: center; gap: 4px;">✕ Rechazada</span>`;
    } else if (item.estado === 'unclaimed') {
      estadoBadge = `<span style="background: #e0f2fe; color: #0369a1; border: 1px solid #7dd3fc; font-size: 0.74rem; font-weight: 900; padding: 3px 9px; border-radius: 8px; display: inline-flex; align-items: center; gap: 4px;">🏦 Sin Reclamar</span>`;
    } else {
      estadoBadge = `<span style="background: #f1f5f9; color: #475569; font-size: 0.74rem; font-weight: 800; padding: 3px 8px; border-radius: 8px;">${item.estado}</span>`;
    }

    // Comprobante y Código Detalle
    const compLabel = item.comprobante || 'Sin ref.';
    const codigoDetalleHtml = item.codigo_detalle 
      ? `<div style="margin-top: 3px;"><span style="background: #e2e8f0; color: #334155; font-family: monospace; font-size: 0.70rem; font-weight: 800; padding: 2px 6px; border-radius: 4px;">Cód: ${item.codigo_detalle}</span></div>` 
      : '';

    // Estudiante y Escuela
    let estHtml = '';
    if (item.estudiante_nombre) {
      estHtml = `
        <div>
          <strong style="color: var(--text-main); font-size: 0.85rem; display: block;">${item.estudiante_nombre}</strong>
          <span style="font-size: 0.74rem; color: var(--text-muted);">${item.estudiante_grado || ''} ${item.estudiante_seccion || ''} · <span style="color: #0284c7; font-weight: 700;">${item.escuela_nombre || ''}</span></span>
          <div style="font-size: 0.72rem; color: #10b981; font-weight: 800; margin-top: 2px;">Saldo: ₡${Number(item.estudiante_saldo || 0).toLocaleString('es-CR')}</div>
        </div>
      `;
    } else {
      estHtml = `<span style="background: #fef3c7; color: #92400e; font-size: 0.75rem; font-weight: 800; padding: 3px 8px; border-radius: 6px;">[Depósito Sin Asignar]</span>`;
    }

    // Remitente / Banco
    const remitenteNombre = item.padre_nombre || 'No indicado';
    const remitenteTel = item.padre_telefono ? `<span style="color: var(--text-muted); font-size: 0.74rem;">${item.padre_telefono}</span>` : '';
    const bancoBadge = item.banco_origen ? `<div style="font-size: 0.70rem; color: #0284c7; font-weight: 700; margin-top: 2px;">🏦 ${item.banco_origen}</div>` : '';

    // Botones de Acción
    let accionesHtml = `
      <button type="button" onclick="openModalDevSinpeDetalle('${item.uid}')" class="dev-action-btn" style="padding: 5px 9px; font-size: 0.75rem;" title="Ver ficha técnica completa">
        👁️ Ficha
      </button>
    `;

    // Si es solicitud pendiente
    if (item.origen === 'solicitud' && item.estado === 'pendiente') {
      accionesHtml += `
        <button type="button" onclick="forzarAprobacionSinpeDev(${item.raw_id})" class="dev-action-btn dev-action-btn-primary" style="padding: 5px 10px; font-size: 0.75rem; background: #16a34a; border-color: #16a34a;" title="Aprobar y acreditar saldo ahora">
          ✓ Aprobar
        </button>
        <button type="button" onclick="abrirModalRechazoSinpeDev(${item.raw_id})" class="dev-action-btn dev-action-btn-danger" style="padding: 5px 8px; font-size: 0.75rem;" title="Rechazar solicitud con motivo">
          ✕
        </button>
      `;
    }

    // Si es notificación bancaria huérfana (sin reclamar)
    if (item.origen === 'banco' && item.estado === 'unclaimed') {
      accionesHtml += `
        <button type="button" onclick="abrirModalVincularBancoDev('${item.raw_id}')" class="dev-action-btn dev-action-btn-primary" style="padding: 5px 10px; font-size: 0.75rem;" title="Asignar y acreditar a un estudiante">
          🔗 Vincular
        </button>
      `;
    }

    return `
      <tr style="border-bottom: 1px solid var(--border); transition: background 0.15s ease;">
        <td style="padding: 12px 14px; white-space: nowrap; color: var(--text-muted); font-size: 0.78rem;">
          ${fechaStr}
        </td>
        <td style="padding: 12px 14px;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <strong style="color: var(--text-main); font-family: monospace; font-size: 0.88rem;">${compLabel}</strong>
            <button type="button" onclick="copiarAlPortapapelesTexto('${compLabel}', this)" style="background: none; border: none; cursor: pointer; color: var(--text-muted); padding: 2px;" title="Copiar comprobante">
              📋
            </button>
          </div>
          ${codigoDetalleHtml}
        </td>
        <td style="padding: 12px 14px; white-space: nowrap;">
          ${origenBadge}
        </td>
        <td style="padding: 12px 14px;">
          ${estHtml}
        </td>
        <td style="padding: 12px 14px;">
          <div style="font-weight: 700; color: var(--text-main); font-size: 0.82rem;">${remitenteNombre}</div>
          ${remitenteTel}
          ${bancoBadge}
        </td>
        <td style="padding: 12px 14px; white-space: nowrap;">
          <strong style="font-size: 1rem; color: #10b981; font-weight: 900;">₡${Number(item.monto || 0).toLocaleString('es-CR')}</strong>
        </td>
        <td style="padding: 12px 14px; white-space: nowrap;">
          ${estadoBadge}
        </td>
        <td style="padding: 12px 14px; text-align: right; white-space: nowrap;">
          <div style="display: inline-flex; gap: 5px; align-items: center;">
            ${accionesHtml}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Debounce para búsqueda en tiempo real
 */
function debounceDevSinpeSearch() {
  if (devSinpeSearchTimer) clearTimeout(devSinpeSearchTimer);
  devSinpeSearchTimer = setTimeout(() => {
    loadDevSinpeUniversal();
  }, 280);
}
window.debounceDevSinpeSearch = debounceDevSinpeSearch;

function clearDevSinpeSearch() {
  const inp = document.getElementById('devSinpeSearchInput');
  if (inp) inp.value = '';
  loadDevSinpeUniversal();
}
window.clearDevSinpeSearch = clearDevSinpeSearch;

/**
 * Llena el selector de escuelas del filtro
 */
async function poblarSelectEscuelasSinpeDev() {
  const select = document.getElementById('devSinpeFilterEscuela');
  if (!select || select.options.length > 1) return;

  try {
    const res = await fetch('/api/developer/escuelas');
    const data = await res.json();
    if (res.ok && Array.isArray(data)) {
      data.forEach(esc => {
        const opt = document.createElement('option');
        opt.value = esc.id;
        opt.textContent = `${esc.nombre} (${esc.codigo || 'ESC'})`;
        select.appendChild(opt);
      });
    }
  } catch (e) {}
}

/**
 * Abre el modal con la ficha técnica completa de una transacción SINPE
 */
function openModalDevSinpeDetalle(uid) {
  const item = currentDevSinpeItems.find(x => x.uid === uid);
  if (!item) return;

  currentDevSinpeSelectedItem = item;
  const modal = document.getElementById('modalDevSinpeDetalle');
  const body = document.getElementById('modalDevSinpeDetalleBody');
  const actionsContainer = document.getElementById('modalDevSinpeDetalleActions');
  if (!modal || !body) return;

  const compLabel = item.comprobante || 'N/A';
  const fechaFmt = item.fecha ? new Date(item.fecha).toLocaleString('es-CR') : 'N/A';
  const procesadoFmt = item.fecha_procesado ? new Date(item.fecha_procesado).toLocaleString('es-CR') : 'Sin procesar';

  body.innerHTML = `
    <!-- Tarjeta Principal con Monto y Comprobante -->
    <div style="background: #f8fafc; border: 1.5px solid var(--border); border-radius: 14px; padding: 16px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
      <div>
        <div style="font-size: 0.70rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.5px;">Comprobante de Pago</div>
        <div style="display: flex; align-items: center; gap: 8px; margin-top: 2px;">
          <span style="font-family: monospace; font-size: 1.25rem; font-weight: 900; color: var(--text-main);">${compLabel}</span>
          <button type="button" onclick="copiarAlPortapapelesTexto('${compLabel}', this)" style="background: none; border: none; cursor: pointer; color: #0284c7; padding: 2px;" title="Copiar comprobante">
            📋 Copiar
          </button>
        </div>
        ${item.codigo_detalle ? `<div style="font-size: 0.74rem; color: #64748b; margin-top: 2px;">Código de Detalle: <strong>${item.codigo_detalle}</strong></div>` : ''}
      </div>
      <div style="text-align: right;">
        <div style="font-size: 0.70rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted);">Monto Transferido</div>
        <div style="font-size: 1.45rem; font-weight: 900; color: #10b981;">₡${Number(item.monto || 0).toLocaleString('es-CR')}</div>
      </div>
    </div>

    <!-- Datos del Estudiante y Escuela -->
    <div style="margin-bottom: 14px;">
      <h4 style="margin: 0 0 8px 0; font-size: 0.84rem; font-weight: 900; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">Beneficiario</h4>
      <div style="background: var(--card-bg); border: 1.5px solid var(--border); border-radius: 12px; padding: 12px; font-size: 0.84rem;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
          <span style="color: var(--text-muted);">Nombre Estudiante:</span>
          <strong style="color: var(--text-main);">${item.estudiante_nombre || '[Sin Asignar]'}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
          <span style="color: var(--text-muted);">Grado y Sección:</span>
          <span style="color: var(--text-main); font-weight: 700;">${item.estudiante_grado || 'N/A'} ${item.estudiante_seccion || ''}</span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
          <span style="color: var(--text-muted);">Escuela / Sede:</span>
          <span style="color: #0284c7; font-weight: 800;">${item.escuela_nombre || 'N/A'}</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span style="color: var(--text-muted);">Saldo Disponible Actual:</span>
          <strong style="color: #10b981; font-weight: 900;">₡${Number(item.estudiante_saldo || 0).toLocaleString('es-CR')}</strong>
        </div>
      </div>
    </div>

    <!-- Datos de Origen y Remitente -->
    <div style="margin-bottom: 14px;">
      <h4 style="margin: 0 0 8px 0; font-size: 0.84rem; font-weight: 900; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">Remitente & Origen Bancario</h4>
      <div style="background: var(--card-bg); border: 1.5px solid var(--border); border-radius: 12px; padding: 12px; font-size: 0.84rem;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
          <span style="color: var(--text-muted);">Nombre Remitente / Padre:</span>
          <strong style="color: var(--text-main);">${item.padre_nombre || 'No especificado'}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
          <span style="color: var(--text-muted);">Teléfono Remitente:</span>
          <span style="color: var(--text-main); font-weight: 700;">${item.padre_telefono ? `<a href="tel:${item.padre_telefono}" style="color:#0284c7;">${item.padre_telefono}</a>` : 'N/A'}</span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
          <span style="color: var(--text-muted);">Banco Emisor:</span>
          <span style="color: var(--text-main); font-weight: 700;">${item.banco_origen || 'SINPE Móvil Interbancario'}</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span style="color: var(--text-muted);">Canal de Registro:</span>
          <span style="font-weight: 800;">${item.origen === 'solicitud' ? '📱 Formulario App Padres' : (item.origen === 'banco' ? '🏦 Webhook / IMAP Bancario' : '💳 Movimiento de Caja')}</span>
        </div>
      </div>
    </div>

    <!-- Auditoría y Tiempos -->
    <div>
      <h4 style="margin: 0 0 8px 0; font-size: 0.84rem; font-weight: 900; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">Auditoría y Estado</h4>
      <div style="background: var(--card-bg); border: 1.5px solid var(--border); border-radius: 12px; padding: 12px; font-size: 0.84rem;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
          <span style="color: var(--text-muted);">Estado Actual:</span>
          <strong style="text-transform: uppercase;">${item.estado}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
          <span style="color: var(--text-muted);">Fecha de Creación:</span>
          <span style="color: var(--text-main);">${fechaFmt}</span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
          <span style="color: var(--text-muted);">Fecha de Procesamiento:</span>
          <span style="color: var(--text-main);">${procesadoFmt}</span>
        </div>
        ${item.procesado_por ? `
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
            <span style="color: var(--text-muted);">Procesado Por:</span>
            <strong style="color: #0284c7;">${item.procesado_por}</strong>
          </div>
        ` : ''}
        ${item.notas ? `
          <div style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border); font-size: 0.80rem; color: #64748b;">
            <strong>Notas / Motivo:</strong> ${item.notas}
          </div>
        ` : ''}
      </div>
    </div>
  `;

  // Botones de acción dinámicos en el pie del modal
  if (actionsContainer) {
    let actHtml = '';
    if (item.origen === 'solicitud' && item.estado === 'pendiente') {
      actHtml = `
        <button type="button" onclick="closeModalDevSinpeDetalle(); forzarAprobacionSinpeDev(${item.raw_id});" class="dev-action-btn dev-action-btn-primary" style="background: #16a34a; border-color: #16a34a; font-weight: 800;">
          ✓ Aprobar Ahora
        </button>
        <button type="button" onclick="closeModalDevSinpeDetalle(); abrirModalRechazoSinpeDev(${item.raw_id});" class="dev-action-btn dev-action-btn-danger" style="font-weight: 800;">
          ✕ Rechazar
        </button>
      `;
    } else if (item.origen === 'banco' && item.estado === 'unclaimed') {
      actHtml = `
        <button type="button" onclick="closeModalDevSinpeDetalle(); abrirModalVincularBancoDev('${item.raw_id}');" class="dev-action-btn dev-action-btn-primary" style="font-weight: 800;">
          🔗 Vincular a Estudiante
        </button>
      `;
    }
    actHtml += `
      <button type="button" onclick="closeModalDevSinpeDetalle()" class="dev-action-btn" style="font-weight: 800;">
        Cerrar
      </button>
    `;
    actionsContainer.innerHTML = actHtml;
  }

  modal.style.display = 'flex';
}
window.openModalDevSinpeDetalle = openModalDevSinpeDetalle;

function closeModalDevSinpeDetalle() {
  const modal = document.getElementById('modalDevSinpeDetalle');
  if (modal) modal.style.display = 'none';
}
window.closeModalDevSinpeDetalle = closeModalDevSinpeDetalle;

/**
 * Copia mensaje listo para responder al padre en WhatsApp
 */
function copiarMensajeSoporteWhatsAppSinpe() {
  if (!currentDevSinpeSelectedItem) return;
  const it = currentDevSinpeSelectedItem;
  const comp = it.comprobante || 'N/A';
  const monto = `₡${Number(it.monto || 0).toLocaleString('es-CR')}`;
  const est = it.estudiante_nombre || 'Estudiante';
  let estadoText = 'Aprobada y acreditada con éxito ✓';
  if (it.estado === 'pendiente') estadoText = 'En proceso de verificación en soda ⏳';
  if (it.estado === 'rechazada') estadoText = `Rechazada (${it.notas || 'Comprobante no verificado'}) ✕`;
  if (it.estado === 'unclaimed') estadoText = 'Depósito recibido en cuenta bancaria pendiente de vincular 🏦';

  const msg = 
`Hola, le saluda Soporte de SiboPay.
Referente a su recarga SINPE Móvil:
• Comprobante: #${comp}
• Monto: ${monto}
• Estudiante: ${est}
• Estado: ${estadoText}
${it.estudiante_saldo !== undefined ? `• Saldo actual disponible: ₡${Number(it.estudiante_saldo).toLocaleString('es-CR')}` : ''}

¡Gracias por utilizar SiboPay Costa Rica!`;

  copiarAlPortapapelesTexto(msg);
  if (window.sounds) window.sounds.playSuccess();
  alert('¡Mensaje copiado al portapapeles! Puedes pegarlo directamente en el chat de WhatsApp con el padre de familia.');
}
window.copiarMensajeSoporteWhatsAppSinpe = copiarMensajeSoporteWhatsAppSinpe;

/**
 * Aprobación forzada por Developer Master
 */
async function forzarAprobacionSinpeDev(solicitudId) {
  const confirmar = confirm('¿Confirmas la aprobación y acreditación inmediata de esta recarga SINPE para el estudiante?');
  if (!confirmar) return;

  try {
    const res = await fetch('/api/developer/sinpe/aprobar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        solicitud_id: solicitudId,
        usuario_id: currentUser?.id || null,
        motivo: 'Aprobación manual forzada desde Master Developer Suite'
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo aprobar la recarga');

    if (window.sounds) window.sounds.playSuccess();
    alert(data.mensaje || '¡Recarga acreditada con éxito!');
    await loadDevSinpeUniversal();
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    alert('Error al aprobar: ' + err.message);
  }
}
window.forzarAprobacionSinpeDev = forzarAprobacionSinpeDev;

/**
 * Rechazo de solicitud Developer
 */
function abrirModalRechazoSinpeDev(solicitudId) {
  const modal = document.getElementById('modalDevSinpeRechazar');
  const inputId = document.getElementById('devRechazoSolicitudId');
  const select = document.getElementById('devRechazoSelectMotivo');
  const textarea = document.getElementById('devRechazoTextoExplicacion');
  if (!modal) return;

  if (inputId) inputId.value = solicitudId;
  if (select) select.value = 'Comprobante no verificado en cuenta bancaria';
  if (textarea) textarea.value = 'El comprobante reportado no aparece acreditado en los movimientos de la cuenta bancaria de la soda.';

  modal.style.display = 'flex';
}
window.abrirModalRechazoSinpeDev = abrirModalRechazoSinpeDev;

function closeModalDevSinpeRechazar() {
  const modal = document.getElementById('modalDevSinpeRechazar');
  if (modal) modal.style.display = 'none';
}
window.closeModalDevSinpeRechazar = closeModalDevSinpeRechazar;

function actualizarTextoMotivoRechazoDev() {
  const select = document.getElementById('devRechazoSelectMotivo');
  const textarea = document.getElementById('devRechazoTextoExplicacion');
  if (!select || !textarea) return;

  if (select.value === 'Comprobante no verificado en cuenta bancaria') {
    textarea.value = 'El comprobante reportado no aparece acreditado en los movimientos de la cuenta bancaria de la soda.';
  } else if (select.value === 'El monto transferido no coincide con la solicitud') {
    textarea.value = 'El monto verificado en la cuenta difiere del valor ingresado en la solicitud de recarga.';
  } else if (select.value === 'Comprobante duplicado ya utilizado anteriormente') {
    textarea.value = 'Este número de comprobante ya fue procesado y acreditado previamente en otra transacción.';
  } else if (select.value === 'Comprobante ilegible o incompleto') {
    textarea.value = 'El número o datos del comprobante bancario no son legibles o están incompletos.';
  } else {
    textarea.value = '';
    textarea.focus();
  }
}
window.actualizarTextoMotivoRechazoDev = actualizarTextoMotivoRechazoDev;

async function ejecutarRechazoSinpeDev(e) {
  e.preventDefault();
  const inputId = document.getElementById('devRechazoSolicitudId');
  const textarea = document.getElementById('devRechazoTextoExplicacion');
  const btn = document.getElementById('btnDevConfirmarRechazo');
  if (!inputId || !textarea) return;

  const solId = inputId.value;
  const motivo = textarea.value.trim();

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Rechazando...';
    }

    const res = await fetch('/api/developer/sinpe/rechazar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        solicitud_id: solId,
        motivo,
        usuario_id: currentUser?.id || null
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo rechazar la solicitud');

    closeModalDevSinpeRechazar();
    if (window.sounds) window.sounds.playSuccess();
    alert(data.mensaje || 'Solicitud rechazada con éxito.');
    await loadDevSinpeUniversal();
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    alert('Error al rechazar: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Confirmar Rechazo';
    }
  }
}
window.ejecutarRechazoSinpeDev = ejecutarRechazoSinpeDev;

/**
 * Vincular notificación bancaria huérfana a estudiante
 */
async function abrirModalVincularBancoDev(bancoTxId) {
  const item = currentDevSinpeItems.find(x => x.raw_id === bancoTxId && x.origen === 'banco');
  if (!item) return;

  currentVincularBancoItem = item;

  const modal = document.getElementById('modalDevSinpeVincular');
  const inputId = document.getElementById('devVincularBancoTxId');
  const resumenBox = document.getElementById('devVincularDepositoResumen');
  const buscadorBox = document.getElementById('devVincularSeccionBuscador');
  const accionesBox = document.getElementById('devVincularFormAcciones');
  const exitoBox = document.getElementById('devVincularResultadoExito');
  const fichaBox = document.getElementById('devVincularFichaEstudiante');

  if (!modal) return;

  // Restaurar vistas
  if (buscadorBox) buscadorBox.style.display = 'block';
  if (accionesBox) accionesBox.style.display = 'block';
  if (exitoBox) exitoBox.style.display = 'none';
  if (fichaBox) fichaBox.style.display = 'none';

  if (inputId) inputId.value = bancoTxId;
  if (resumenBox) {
    resumenBox.innerHTML = `
      <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
        <span style="color: var(--text-muted);">Comprobante / Ref:</span>
        <strong style="color: var(--text-main); font-family: monospace;">${item.comprobante}</strong>
      </div>
      <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
        <span style="color: var(--text-muted);">Monto Bancario Huérfano:</span>
        <strong style="color: #10b981; font-size: 1.05rem;">₡${Number(item.monto).toLocaleString('es-CR')}</strong>
      </div>
      <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
        <span style="color: var(--text-muted);">Banco de Origen:</span>
        <span>${item.banco_origen || 'Banco'}</span>
      </div>
      <div style="display: flex; justify-content: space-between;">
        <span style="color: var(--text-muted);">Remitente Reportado:</span>
        <span>${item.padre_nombre || 'N/A'} ${item.padre_telefono ? `(${item.padre_telefono})` : ''}</span>
      </div>
    `;
  }

  // Limpiar campos de búsqueda previa
  const searchInput = document.getElementById('devVincularEstudianteSearch');
  if (searchInput) searchInput.value = '';
  const inputNotas = document.getElementById('devVincularNotas');
  if (inputNotas) inputNotas.value = '';

  modal.style.display = 'flex';

  // Cargar estudiantes para selector
  await cargarEstudiantesParaVinculacion();
  if (searchInput) searchInput.focus();
}
window.abrirModalVincularBancoDev = abrirModalVincularBancoDev;

function closeModalDevSinpeVincular() {
  const modal = document.getElementById('modalDevSinpeVincular');
  if (modal) modal.style.display = 'none';
}
window.closeModalDevSinpeVincular = closeModalDevSinpeVincular;

function cerrarModalVincularExitoDev() {
  closeModalDevSinpeVincular();
  loadDevSinpeUniversal();
}
window.cerrarModalVincularExitoDev = cerrarModalVincularExitoDev;

async function cargarEstudiantesParaVinculacion() {
  const select = document.getElementById('devVincularEstudianteSelect');
  if (!select) return;

  select.innerHTML = '<option disabled>Cargando lista de estudiantes del sistema...</option>';

  try {
    let res = await fetch('/api/developer/estudiantes/buscar');
    if (!res.ok) {
      res = await fetch('/api/estudiantes');
    }
    const data = await res.json();
    if (Array.isArray(data)) {
      devCachedEstudiantesList = data;
    }
  } catch (e) {
    console.error('Error cargando estudiantes para vinculación:', e);
  }

  filtrarEstudiantesParaVincular();
}

function filtrarEstudiantesParaVincular() {
  const searchInput = document.getElementById('devVincularEstudianteSearch');
  const select = document.getElementById('devVincularEstudianteSelect');
  const countBadge = document.getElementById('devVincularCountBadge');
  if (!select) return;

  const normalizeStr = str => (str || '')
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  const rawQuery = (searchInput?.value || '').trim();
  const query = normalizeStr(rawQuery);

  const filtered = devCachedEstudiantesList.filter(e => {
    if (!query) return true;
    return normalizeStr(e.nombre_completo).includes(query) ||
           normalizeStr(e.codigo_estudiante).includes(query) ||
           normalizeStr(e.padre_nombre).includes(query) ||
           normalizeStr(e.padre_telefono).includes(query) ||
           normalizeStr(e.grado).includes(query) ||
           normalizeStr(e.seccion).includes(query) ||
           normalizeStr(e.escuela_nombre).includes(query);
  });

  if (countBadge) {
    countBadge.textContent = `${filtered.length} estudiante(s)`;
  }

  if (filtered.length === 0) {
    select.innerHTML = `<option disabled value="" style="padding: 10px; color: #ef4444; font-weight: 700;">⚠️ No se encontró ningún estudiante con "${rawQuery}"</option>`;
    const fichaBox = document.getElementById('devVincularFichaEstudiante');
    if (fichaBox) fichaBox.style.display = 'none';
    return;
  }

  select.innerHTML = filtered.map(e => {
    const escBadge = e.escuela_nombre ? ` [${e.escuela_nombre}]` : '';
    const carnet = e.codigo_estudiante ? ` · ${e.codigo_estudiante}` : '';
    const saldo = Number(e.saldo_colones || 0).toLocaleString('es-CR');
    return `
      <option value="${e.id}" style="padding: 8px 10px; font-weight: 700; border-bottom: 1px solid var(--border);">
        ${e.nombre_completo}${carnet} (${e.grado || ''} ${e.seccion || ''})${escBadge} - Saldo: ₡${saldo}
      </option>
    `;
  }).join('');

  if (filtered.length > 0) {
    select.selectedIndex = 0;
    seleccionarEstudianteParaVincular(select.value);
  }
}
window.filtrarEstudiantesParaVincular = filtrarEstudiantesParaVincular;

/**
 * Desplegar Ficha Técnica del Estudiante con saldo actual y saldo proyectado
 */
function seleccionarEstudianteParaVincular(estudianteId, isDblClick = false) {
  const fichaBox = document.getElementById('devVincularFichaEstudiante');
  if (!fichaBox) return;

  if (!estudianteId) {
    fichaBox.style.display = 'none';
    return;
  }

  const est = devCachedEstudiantesList.find(x => String(x.id) === String(estudianteId));
  if (!est) {
    fichaBox.style.display = 'none';
    return;
  }

  const avatar = document.getElementById('devVincularFichaAvatar');
  const carnet = document.getElementById('devVincularFichaCarnet');
  const escuela = document.getElementById('devVincularFichaEscuela');
  const nombre = document.getElementById('devVincularFichaNombre');
  const grado = document.getElementById('devVincularFichaGrado');
  const padre = document.getElementById('devVincularFichaPadre');
  const saldoActualEl = document.getElementById('devVincularSaldoActual');
  const montoIngresoEl = document.getElementById('devVincularMontoIngreso');
  const saldoProyectadoEl = document.getElementById('devVincularSaldoProyectado');

  // Iniciales avatar
  const parts = (est.nombre_completo || 'ES').trim().split(/\s+/);
  const initials = parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : parts[0].substring(0, 2).toUpperCase();
  if (avatar) avatar.textContent = initials;

  if (carnet) carnet.textContent = est.codigo_estudiante || `ID #${est.id}`;
  if (escuela) escuela.textContent = est.escuela_nombre || 'Escuela';
  if (nombre) nombre.textContent = est.nombre_completo;
  if (grado) grado.textContent = `${est.grado || ''} ${est.seccion ? '· Sec. ' + est.seccion : ''}`.trim() || 'Estudiante';
  if (padre) padre.textContent = `${est.padre_nombre || 'Sin encargado'} ${est.padre_telefono ? '(' + est.padre_telefono + ')' : ''}`;

  const saldoActual = Number(est.saldo_colones || 0);
  const montoIngreso = Number(currentVincularBancoItem?.monto || 0);
  const saldoProyectado = saldoActual + montoIngreso;

  if (saldoActualEl) saldoActualEl.textContent = `₡${saldoActual.toLocaleString('es-CR')}`;
  if (montoIngresoEl) montoIngresoEl.textContent = `+₡${montoIngreso.toLocaleString('es-CR')}`;
  if (saldoProyectadoEl) saldoProyectadoEl.textContent = `₡${saldoProyectado.toLocaleString('es-CR')}`;

  fichaBox.style.display = 'block';

  // Si fue doble clic, dar animación de foco al botón de confirmar
  if (isDblClick) {
    const btn = document.getElementById('btnDevConfirmarVincular');
    if (btn) {
      btn.focus();
      btn.style.transform = 'scale(1.04)';
      setTimeout(() => { if (btn) btn.style.transform = ''; }, 300);
    }
  }
}
window.seleccionarEstudianteParaVincular = seleccionarEstudianteParaVincular;

async function ejecutarVinculacionBancoDev(e) {
  e.preventDefault();
  const inputId = document.getElementById('devVincularBancoTxId');
  const selectEst = document.getElementById('devVincularEstudianteSelect');
  const inputNotas = document.getElementById('devVincularNotas');
  const btn = document.getElementById('btnDevConfirmarVincular');

  if (!inputId || !selectEst || !selectEst.value) {
    alert('Por favor selecciona el estudiante que recibirá el saldo.');
    return;
  }

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Acreditando en PostgreSQL...';
    }

    const res = await fetch('/api/developer/sinpe/vincular-banco', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        banco_tx_id: inputId.value,
        estudiante_id: parseInt(selectEst.value, 10),
        usuario_id: currentUser?.id || null,
        notas: inputNotas?.value || null
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo vincular la transacción');

    const resObj = data.resultado || {};

    // Actualizar saldo del estudiante en la caché local
    const cachedEst = devCachedEstudiantesList.find(x => x.id === resObj.estudiante_id);
    if (cachedEst) {
      cachedEst.saldo_colones = resObj.saldo_nuevo;
    }

    // Mostrar pantalla de auditoría post-vinculación en el modal
    const buscadorBox = document.getElementById('devVincularSeccionBuscador');
    const accionesBox = document.getElementById('devVincularFormAcciones');
    const exitoBox = document.getElementById('devVincularResultadoExito');

    if (buscadorBox) buscadorBox.style.display = 'none';
    if (accionesBox) accionesBox.style.display = 'none';

    if (exitoBox) {
      const nombreEl = document.getElementById('devExitoEstudianteNombre');
      const compEl = document.getElementById('devExitoComprobante');
      const antEl = document.getElementById('devExitoSaldoAnterior');
      const montoEl = document.getElementById('devExitoMontoAcreditado');
      const nuevoEl = document.getElementById('devExitoSaldoNuevo');

      if (nombreEl) nombreEl.textContent = resObj.estudiante_nombre || 'Estudiante';
      if (compEl) compEl.textContent = `#${resObj.comprobante || 'N/A'}`;
      if (antEl) antEl.textContent = `₡${Number(resObj.saldo_anterior || 0).toLocaleString('es-CR')}`;
      if (montoEl) montoEl.textContent = `+₡${Number(resObj.monto || 0).toLocaleString('es-CR')}`;
      if (nuevoEl) nuevoEl.textContent = `₡${Number(resObj.saldo_nuevo || 0).toLocaleString('es-CR')}`;

      exitoBox.style.display = 'block';
    }

    if (window.sounds) window.sounds.playSuccess();
    // Refrescar tabla del panel developer en segundo plano
    loadDevSinpeUniversal();
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    alert('Error al vincular: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Acreditar y Vincular';
    }
  }
}
window.ejecutarVinculacionBancoDev = ejecutarVinculacionBancoDev;

/**
 * Simulador de Notificación Bancaria para pruebas
 */
function openModalDevSimularSinpe() {
  const modal = document.getElementById('modalDevSimularSinpe');
  if (modal) modal.style.display = 'flex';
}
window.openModalDevSimularSinpe = openModalDevSimularSinpe;

function closeModalDevSimularSinpe() {
  const modal = document.getElementById('modalDevSimularSinpe');
  if (modal) modal.style.display = 'none';
}
window.closeModalDevSimularSinpe = closeModalDevSimularSinpe;

async function ejecutarSimulacionSinpeDev(e) {
  e.preventDefault();
  const banco = document.getElementById('devSimBanco')?.value;
  const monto = parseInt(document.getElementById('devSimMonto')?.value || 3500, 10);
  const remitente = document.getElementById('devSimRemitente')?.value;
  const telefono = document.getElementById('devSimTelefono')?.value;
  const codigo = document.getElementById('devSimCodigoDetalle')?.value || null;
  const btn = document.getElementById('btnDevConfirmarSimulacion');

  const randomRef = 'BAC' + Math.floor(100000 + Math.random() * 900000);

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Inyectando...';
    }

    const res = await fetch('/api/sinpe/simular-correo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        banco,
        monto,
        remitente,
        telefono,
        codigo,
        comprobante: randomRef
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo simular la transacción');

    closeModalDevSimularSinpe();
    if (window.sounds) window.sounds.playSuccess();
    alert(`⚡ ¡Transacción simulada con éxito!\nReferencia: #${randomRef} por ₡${monto.toLocaleString('es-CR')}.\nYa aparece en el Buscador SINPE.`);
    await loadDevSinpeUniversal();
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    alert('Error al simular: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '⚡ Disparar Transacción';
    }
  }
}
window.ejecutarSimulacionSinpeDev = ejecutarSimulacionSinpeDev;

/**
 * Exportar resultados a CSV
 */
function exportarSinpeUniversalCsv() {
  if (!currentDevSinpeItems || currentDevSinpeItems.length === 0) {
    alert('No hay registros en los resultados actuales para exportar.');
    return;
  }

  const headers = ['Fecha', 'Comprobante', 'Codigo Detalle', 'Origen', 'Estado', 'Monto (CRC)', 'Estudiante', 'Escuela', 'Remitente', 'Telefono', 'Banco', 'Notas'];
  const rows = currentDevSinpeItems.map(item => [
    item.fecha || '',
    item.comprobante || '',
    item.codigo_detalle || '',
    item.origen || '',
    item.estado || '',
    item.monto || 0,
    item.estudiante_nombre || 'Sin Asignar',
    item.escuela_nombre || '',
    item.padre_nombre || '',
    item.padre_telefono || '',
    item.banco_origen || '',
    (item.notas || '').replace(/\r?\n/g, ' ')
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const dateTag = new Date().toISOString().slice(0, 10);
  a.download = `reporte_sinpe_universal_sibopay_${dateTag}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    if (a.parentNode) a.parentNode.removeChild(a);
    URL.revokeObjectURL(url);
  }, 250);
}
window.exportarSinpeUniversalCsv = exportarSinpeUniversalCsv;

/**
 * Helper para copiar texto al portapapeles
 */
function copiarAlPortapapelesTexto(texto, btnEl) {
  if (!texto) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(texto).then(() => {
      if (btnEl) {
        const orig = btnEl.innerHTML;
        btnEl.innerHTML = '✓ Copiado';
        setTimeout(() => { btnEl.innerHTML = orig; }, 1500);
      }
    }).catch(() => {});
  } else {
    const ta = document.createElement('textarea');
    ta.value = texto;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    if (btnEl) {
      const orig = btnEl.innerHTML;
      btnEl.innerHTML = '✓ Copiado';
      setTimeout(() => { btnEl.innerHTML = orig; }, 1500);
    }
  }
}
window.copiarAlPortapapelesTexto = copiarAlPortapapelesTexto;

// ========================================================
// KARDEX & AUDITORÍA 360° DE ESTUDIANTES (DEVELOPER MASTER)
// ========================================================

let currentKardexEstudianteId = null;
let currentKardexData = null;
let currentKardexSubTab = 'compras';
let devKardexEstudiantesList = [];

/**
 * Inicializar la pestaña de Kardex en el Panel Developer
 */
async function inicializarDevKardex() {
  await poblarEscuelasKardexDev();
  await recargarListaKardexDev();
}
window.inicializarDevKardex = inicializarDevKardex;

async function poblarEscuelasKardexDev() {
  const select = document.getElementById('devKardexEscuelaFilter');
  if (!select) return;

  const currentVal = select.value;
  select.innerHTML = '<option value="todas">🏫 Todas las Sedes</option>';

  try {
    const res = await fetch('/api/developer/escuelas');
    if (res.ok) {
      const escuelas = await res.json();
      if (Array.isArray(escuelas)) {
        escuelas.forEach(esc => {
          const opt = document.createElement('option');
          opt.value = esc.id;
          opt.textContent = `${esc.nombre} (${esc.codigo || 'SEDE'})`;
          select.appendChild(opt);
        });
      }
    }
  } catch (e) {
    console.warn('No se pudieron cargar escuelas para filtro de kardex:', e);
  }

  if (currentVal) select.value = currentVal;
}

async function recargarListaKardexDev() {
  const studentListEl = document.getElementById('devKardexStudentList');
  if (studentListEl) {
    studentListEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">⏳ Cargando alumnos...</div>';
  }

  try {
    const res = await fetch('/api/developer/estudiantes/buscar');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        devKardexEstudiantesList = data;
      }
    }
  } catch (err) {
    console.error('Error cargando estudiantes para kardex dev:', err);
  }

  buscarEstudiantesKardexDev();
}
window.recargarListaKardexDev = recargarListaKardexDev;

/**
 * Filtrar estudiantes por texto y escuela en tiempo real
 */
function buscarEstudiantesKardexDev() {
  const searchInput = document.getElementById('devKardexSearchInput');
  const escuelaSelect = document.getElementById('devKardexEscuelaFilter');
  const studentListEl = document.getElementById('devKardexStudentList');
  const countBadge = document.getElementById('devKardexResultCountBadge');

  if (!studentListEl) return;

  const normalizeStr = str => (str || '')
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  const query = normalizeStr(searchInput?.value || '');
  const escuelaId = escuelaSelect?.value || 'todas';

  const filtered = devKardexEstudiantesList.filter(e => {
    // Filtro por escuela
    if (escuelaId !== 'todas' && String(e.escuela_id) !== String(escuelaId)) {
      return false;
    }
    if (!query) return true;
    return normalizeStr(e.nombre_completo).includes(query) ||
           normalizeStr(e.codigo_estudiante).includes(query) ||
           normalizeStr(e.padre_nombre).includes(query) ||
           normalizeStr(e.padre_telefono).includes(query) ||
           normalizeStr(e.grado).includes(query) ||
           normalizeStr(e.seccion).includes(query) ||
           normalizeStr(e.escuela_nombre).includes(query);
  });

  if (countBadge) {
    countBadge.textContent = `${filtered.length} estudiante(s)`;
  }

  if (filtered.length === 0) {
    studentListEl.innerHTML = `
      <div style="padding: 30px 15px; text-align: center; color: var(--text-muted); font-size: 0.84rem;">
        🔍 No se encontraron alumnos con los criterios seleccionados.
      </div>
    `;
    return;
  }

  studentListEl.innerHTML = filtered.map(e => {
    const isSelected = String(e.id) === String(currentKardexEstudianteId);
    const parts = (e.nombre_completo || 'ES').trim().split(/\s+/);
    const initials = parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : parts[0].substring(0, 2).toUpperCase();
    const saldo = Number(e.saldo_colones || 0).toLocaleString('es-CR');
    const escBadge = e.escuela_nombre ? `<span style="font-size: 0.68rem; color: #64748b; background: var(--border); padding: 1px 6px; border-radius: 4px; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(e.escuela_nombre)}</span>` : '';

    return `
      <div onclick="seleccionarEstudianteKardexDev(${e.id})" style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border-radius: 12px; border: 1.5px solid ${isSelected ? '#0284c7' : 'var(--border)'}; background: ${isSelected ? 'rgba(2, 132, 199, 0.08)' : 'var(--bg-main)'}; cursor: pointer; transition: all 0.15s ease;">
        <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">
          <div style="width: 36px; height: 36px; border-radius: 10px; background: ${isSelected ? 'linear-gradient(135deg, #0284c7, #3b82f6)' : 'linear-gradient(135deg, #64748b, #475569)'}; color: white; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.85rem; flex-shrink: 0;">
            ${initials}
          </div>
          <div style="min-width: 0; flex: 1;">
            <div style="font-weight: 800; font-size: 0.84rem; color: var(--text-main); word-break: break-word; line-height: 1.2;">
              ${escapeHtml(e.nombre_completo)}
            </div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              <span style="font-weight: 700; color: #0284c7;">${e.codigo_estudiante || ''}</span>
              <span>${e.grado || ''} ${e.seccion ? '· ' + e.seccion : ''}</span>
              ${escBadge}
            </div>
          </div>
        </div>
        <div style="text-align: right; flex-shrink: 0;">
          <div style="font-size: 0.88rem; font-weight: 900; color: #10b981;">₡${saldo}</div>
          <span style="font-size: 0.65rem; color: #64748b;">Saldo</span>
        </div>
      </div>
    `;
  }).join('');

  // Si no hay estudiante seleccionado o el seleccionado ya no está en la lista filtrada, seleccionar el primero
  const isSelectedInList = filtered.some(e => String(e.id) === String(currentKardexEstudianteId));
  if (!isSelectedInList && filtered.length > 0) {
    seleccionarEstudianteKardexDev(filtered[0].id);
  }
}
window.buscarEstudiantesKardexDev = buscarEstudiantesKardexDev;

/**
 * Seleccionar un estudiante y cargar su Kardex 360°
 */
async function seleccionarEstudianteKardexDev(studentId) {
  currentKardexEstudianteId = studentId;
  await cargarKardexEstudianteDev(studentId);
  buscarEstudiantesKardexDev();
}
window.seleccionarEstudianteKardexDev = seleccionarEstudianteKardexDev;

/**
 * Consultar datos del endpoint y poblar la vista
 */
async function cargarKardexEstudianteDev(studentId) {
  const placeholder = document.getElementById('devKardexPlaceholder');
  const studentView = document.getElementById('devKardexStudentView');

  if (placeholder) placeholder.style.display = 'none';
  if (studentView) studentView.style.display = 'block';

  try {
    const res = await fetch(`/api/developer/estudiantes/${studentId}/kardex`);
    if (!res.ok) throw new Error('No se pudo obtener el kardex del estudiante');
    const data = await res.json();
    currentKardexData = data;

    const est = data.estudiante || {};
    const totales = data.totales || {};

    // 1. Cabecera Ficha Técnica
    const avatar = document.getElementById('devKardexAvatar');
    const carnet = document.getElementById('devKardexBadgeCarnet');
    const escuela = document.getElementById('devKardexBadgeEscuela');
    const nombre = document.getElementById('devKardexNombre');
    const gradoSeccion = document.getElementById('devKardexGradoSeccion');
    const padreInfo = document.getElementById('devKardexPadreInfo');

    const parts = (est.nombre_completo || 'ES').trim().split(/\s+/);
    const initials = parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : parts[0].substring(0, 2).toUpperCase();
    if (avatar) avatar.textContent = initials;

    if (carnet) carnet.textContent = est.codigo_estudiante || `ID #${est.id}`;
    if (escuela) escuela.textContent = est.escuela_nombre || 'Sede';
    if (nombre) nombre.textContent = est.nombre_completo;
    if (gradoSeccion) gradoSeccion.textContent = `${est.grado || 'Estudiante'} ${est.seccion ? '· Sección ' + est.seccion : ''}`;
    
    if (padreInfo) {
      const tel = est.padre_telefono ? ` · Tel: ${est.padre_telefono}` : '';
      padreInfo.textContent = `Encargado: ${est.padre_nombre || 'N/A'}${tel}`;
    }

    // 2. KPIs
    const kpiSaldo = document.getElementById('devKardexKpiSaldoActual');
    const kpiRecargas = document.getElementById('devKardexKpiTotalRecargas');
    const kpiCantRecargas = document.getElementById('devKardexKpiCantRecargas');
    const kpiCompras = document.getElementById('devKardexKpiTotalCompras');
    const kpiCantCompras = document.getElementById('devKardexKpiCantCompras');
    const kpiLimite = document.getElementById('devKardexKpiLimiteDiario');

    if (kpiSaldo) kpiSaldo.textContent = `₡${Number(totales.saldo_actual || 0).toLocaleString('es-CR')}`;
    if (kpiRecargas) kpiRecargas.textContent = `₡${Number(totales.total_recargas || 0).toLocaleString('es-CR')}`;
    if (kpiCantRecargas) kpiCantRecargas.textContent = `${totales.cant_recargas || 0} recargas`;
    if (kpiCompras) kpiCompras.textContent = `₡${Number(totales.total_compras || 0).toLocaleString('es-CR')}`;
    if (kpiCantCompras) kpiCantCompras.textContent = `${totales.cant_compras || 0} compras`;
    if (kpiLimite) kpiLimite.textContent = `₡${Number(est.limite_diario_colones || 0).toLocaleString('es-CR')}`;

    // 3. Contadores en pestañas
    const badgeCompras = document.getElementById('devKardexBadgeTabComprasCount');
    const badgeRecargas = document.getElementById('devKardexBadgeTabRecargasCount');
    const badgeMov = document.getElementById('devKardexBadgeTabMovimientosCount');

    if (badgeCompras) badgeCompras.textContent = data.compras ? data.compras.length : 0;
    if (badgeRecargas) badgeRecargas.textContent = data.recargas ? data.recargas.length : 0;
    if (badgeMov) badgeMov.textContent = data.movimientos ? data.movimientos.length : 0;

    // 4. Renderizar la subvista activa
    renderizarSubVistaKardexDev(currentKardexSubTab);
  } catch (err) {
    console.error('Error cargando kardex del estudiante:', err);
    if (studentView) {
      studentView.innerHTML = `
        <div style="background: #fef2f2; border: 1.5px solid #f87171; border-radius: 14px; padding: 20px; color: #b91c1c; text-align: center;">
          ⚠️ Error al consultar el Kardex del estudiante: ${err.message}
        </div>
      `;
    }
  }
}
window.cargarKardexEstudianteDev = cargarKardexEstudianteDev;

/**
 * Cambiar entre sub-pestañas: 'compras', 'recargas', 'movimientos'
 */
function cambiarSubTabKardexDev(subTab) {
  currentKardexSubTab = subTab;

  const btnCompras = document.getElementById('btnDevKardexTabCompras');
  const btnRecargas = document.getElementById('btnDevKardexTabRecargas');
  const btnMov = document.getElementById('btnDevKardexTabMovimientos');

  const viewCompras = document.getElementById('devKardexSubViewCompras');
  const viewRecargas = document.getElementById('devKardexSubViewRecargas');
  const viewMov = document.getElementById('devKardexSubViewMovimientos');

  // Clases botones
  if (btnCompras) {
    btnCompras.className = `dev-action-btn ${subTab === 'compras' ? 'dev-action-btn-primary' : 'dev-action-btn-outline'}`;
  }
  if (btnRecargas) {
    btnRecargas.className = `dev-action-btn ${subTab === 'recargas' ? 'dev-action-btn-primary' : 'dev-action-btn-outline'}`;
  }
  if (btnMov) {
    btnMov.className = `dev-action-btn ${subTab === 'movimientos' ? 'dev-action-btn-primary' : 'dev-action-btn-outline'}`;
  }

  // Visibilidad vistas
  if (viewCompras) viewCompras.style.display = subTab === 'compras' ? 'block' : 'none';
  if (viewRecargas) viewRecargas.style.display = subTab === 'recargas' ? 'block' : 'none';
  if (viewMov) viewMov.style.display = subTab === 'movimientos' ? 'block' : 'none';

  renderizarSubVistaKardexDev(subTab);
}
window.cambiarSubTabKardexDev = cambiarSubTabKardexDev;

/**
 * Renderizar la sub-vista seleccionada con datos
 */
function renderizarSubVistaKardexDev(subTab) {
  if (!currentKardexData) return;

  if (subTab === 'compras') {
    const container = document.getElementById('devKardexSubViewCompras');
    if (!container) return;

    const compras = currentKardexData.compras || [];
    if (compras.length === 0) {
      container.innerHTML = `
        <div style="padding: 40px 20px; text-align: center; color: var(--text-muted); font-size: 0.88rem;">
          🛒 Este estudiante aún no registra compras de soda ni meriendas.
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 12px;">
        ${compras.map(o => {
          const fecha = o.creado_en ? new Date(o.creado_en).toLocaleString('es-CR', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Fecha N/A';
          const items = Array.isArray(o.items) ? o.items : [];
          const isCancelado = o.estado === 'cancelado';
          const total = Number(o.total_colones || 0).toLocaleString('es-CR');

          let estadoBadge = `<span style="background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0; padding: 2px 8px; border-radius: 6px; font-weight: 800; font-size: 0.72rem;">✓ ${o.estado || 'Entregado'}</span>`;
          if (isCancelado) {
            estadoBadge = `<span style="background: #fef2f2; color: #ef4444; border: 1px solid #fecaca; padding: 2px 8px; border-radius: 6px; font-weight: 800; font-size: 0.72rem;">✕ Cancelado</span>`;
          } else if (o.estado === 'pendiente' || o.estado === 'en_preparacion') {
            estadoBadge = `<span style="background: #fffbeb; color: #d97706; border: 1px solid #fde68a; padding: 2px 8px; border-radius: 6px; font-weight: 800; font-size: 0.72rem;">⏳ ${o.estado}</span>`;
          }

          return `
            <div style="background: var(--bg-main); border: 1px solid var(--border); border-radius: 14px; padding: 14px;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; flex-wrap: wrap; gap: 8px;">
                <div>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <strong style="color: var(--text-main); font-size: 0.92rem;">#${o.codigo_orden || 'ORD-' + o.id}</strong>
                    ${estadoBadge}
                    <span style="font-size: 0.72rem; color: #0284c7; font-weight: 700; background: rgba(2,132,199,0.08); padding: 2px 6px; border-radius: 4px;">${o.tipo_orden === 'preorden' ? 'Preorden Recreo' : 'Caja Mostrador'}</span>
                  </div>
                  <div style="font-size: 0.74rem; color: var(--text-muted); margin-top: 3px;">
                    📅 ${fecha} ${o.momento_entrega_label ? `· ⏰ ${o.momento_entrega_label}` : ''}
                  </div>
                </div>
                <div style="text-align: right;">
                  <div style="font-size: 1.15rem; font-weight: 950; color: ${isCancelado ? 'var(--text-muted)' : '#d97706'}; ${isCancelado ? 'text-decoration: line-through;' : ''}">
                    ₡${total}
                  </div>
                  <span style="font-size: 0.68rem; color: #64748b; font-weight: 700;">Total de la compra</span>
                </div>
              </div>

              <!-- DESGLOSE DE PRODUCTOS -->
              <div style="background: var(--card-bg); border: 1px dashed var(--border); border-radius: 10px; padding: 10px 12px; margin-top: 8px;">
                <div style="font-size: 0.72rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase; margin-bottom: 6px;">
                  Productos Adquiridos:
                </div>
                <div style="display: flex; flex-direction: column; gap: 4px;">
                  ${items.map(it => `
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.82rem;">
                      <div>
                        <span style="margin-right: 4px;">${it.icono || '🥪'}</span>
                        <strong style="color: var(--text-main);">${it.cantidad}x ${escapeHtml(it.nombre || 'Producto')}</strong>
                      </div>
                      <span style="color: #64748b; font-weight: 700;">
                        ₡${Number(it.precio_unitario || 0).toLocaleString('es-CR')} c/u = <strong style="color: var(--text-main);">₡${Number(it.subtotal || 0).toLocaleString('es-CR')}</strong>
                      </span>
                    </div>
                  `).join('')}
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } else if (subTab === 'recargas') {
    const container = document.getElementById('devKardexSubViewRecargas');
    if (!container) return;

    const recargas = currentKardexData.recargas || [];
    if (recargas.length === 0) {
      container.innerHTML = `
        <div style="padding: 40px 20px; text-align: center; color: var(--text-muted); font-size: 0.88rem;">
          ⚡ Este estudiante aún no registra recargas de saldo.
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 12px;">
        ${recargas.map(r => {
          const fecha = r.fecha ? new Date(r.fecha).toLocaleString('es-CR', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Fecha N/A';
          const isSinpe = r.tipo === 'recarga_sinpe';
          const monto = Number(r.monto_colones || 0).toLocaleString('es-CR');
          const saldoPrev = Number(r.saldo_previo || 0).toLocaleString('es-CR');
          const saldoPost = Number(r.saldo_posterior || 0).toLocaleString('es-CR');

          return `
            <div style="background: var(--bg-main); border: 1.5px solid rgba(16, 185, 129, 0.25); border-radius: 14px; padding: 14px; box-shadow: 0 2px 8px rgba(16, 185, 129, 0.04);">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 8px;">
                <div>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="background: ${isSinpe ? '#e0f2fe' : '#ecfdf5'}; color: ${isSinpe ? '#0369a1' : '#059669'}; border: 1px solid ${isSinpe ? '#bae6fd' : '#a7f3d0'}; padding: 3px 8px; border-radius: 6px; font-weight: 800; font-size: 0.74rem;">
                      ${isSinpe ? '📲 Recarga SINPE Móvil' : '💵 Recarga en Caja'}
                    </span>
                    ${r.comprobante_sinpe ? `<code style="font-size: 0.74rem; background: var(--card-bg); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border);">Ref #${r.comprobante_sinpe}</code>` : ''}
                  </div>
                  <div style="font-size: 0.76rem; color: var(--text-muted); margin-top: 4px;">
                    📅 ${fecha}
                  </div>
                  <div style="font-size: 0.8rem; color: var(--text-main); font-weight: 600; margin-top: 4px;">
                    ${escapeHtml(r.descripcion || 'Recarga de monedero')}
                  </div>
                </div>
                <div style="text-align: right;">
                  <div style="font-size: 1.25rem; font-weight: 950; color: #10b981;">
                    +₡${monto}
                  </div>
                  <span style="font-size: 0.68rem; color: #64748b; font-weight: 700;">Acreditado a cuenta</span>
                </div>
              </div>

              <!-- TRAZABILIDAD DE SALDOS -->
              <div style="display: flex; justify-content: space-between; align-items: center; background: var(--card-bg); border-radius: 8px; padding: 6px 12px; margin-top: 10px; font-size: 0.75rem; border: 1px solid var(--border);">
                <span style="color: var(--text-muted);">Saldo antes: <strong>₡${saldoPrev}</strong></span>
                <span style="color: #0284c7; font-weight: 800;">➔</span>
                <span style="color: #065f46; font-weight: 800;">Saldo resultante: <strong style="color: #10b981;">₡${saldoPost}</strong></span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } else if (subTab === 'movimientos') {
    const container = document.getElementById('devKardexSubViewMovimientos');
    if (!container) return;

    const movimientos = currentKardexData.movimientos || [];
    if (movimientos.length === 0) {
      container.innerHTML = `
        <div style="padding: 40px 20px; text-align: center; color: var(--text-muted); font-size: 0.88rem;">
          📊 Este estudiante aún no registra movimientos en el sistema.
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse; font-size: 0.82rem; text-align: left;">
          <thead>
            <tr style="border-bottom: 1.5px solid var(--border); color: var(--text-muted); font-size: 0.72rem; text-transform: uppercase;">
              <th style="padding: 10px 8px;">Fecha / Hora</th>
              <th style="padding: 10px 8px;">Tipo</th>
              <th style="padding: 10px 8px;">Descripción & Referencia</th>
              <th style="padding: 10px 8px; text-align: right;">Saldo Previo</th>
              <th style="padding: 10px 8px; text-align: right;">Movimiento</th>
              <th style="padding: 10px 8px; text-align: right;">Saldo Posterior</th>
            </tr>
          </thead>
          <tbody>
            ${movimientos.map(m => {
              const fecha = m.fecha ? new Date(m.fecha).toLocaleString('es-CR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
              const esIngreso = Number(m.monto_colones) > 0;
              const montoSigno = esIngreso ? `+₡${Number(m.monto_colones).toLocaleString('es-CR')}` : `-₡${Math.abs(Number(m.monto_colones)).toLocaleString('es-CR')}`;
              const montoColor = esIngreso ? '#10b981' : '#ef4444';

              return `
                <tr style="border-bottom: 1px solid var(--border);">
                  <td style="padding: 10px 8px; white-space: nowrap; color: var(--text-muted);">${fecha}</td>
                  <td style="padding: 10px 8px;">
                    <span style="font-size: 0.72rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; background: ${esIngreso ? '#ecfdf5' : '#fef2f2'}; color: ${esIngreso ? '#059669' : '#dc2626'};">
                      ${m.tipo}
                    </span>
                  </td>
                  <td style="padding: 10px 8px; color: var(--text-main);">
                    <div>${escapeHtml(m.descripcion || '')}</div>
                    ${m.comprobante_sinpe ? `<code style="font-size: 0.7rem; color: #0284c7;">Ref #${m.comprobante_sinpe}</code>` : ''}
                    ${m.codigo_orden ? `<code style="font-size: 0.7rem; color: #d97706;">#${m.codigo_orden}</code>` : ''}
                  </td>
                  <td style="padding: 10px 8px; text-align: right; color: #64748b;">₡${Number(m.saldo_previo || 0).toLocaleString('es-CR')}</td>
                  <td style="padding: 10px 8px; text-align: right; font-weight: 900; color: ${montoColor};">${montoSigno}</td>
                  <td style="padding: 10px 8px; text-align: right; font-weight: 800; color: var(--text-main);">₡${Number(m.saldo_posterior || 0).toLocaleString('es-CR')}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
}

function abrirCarnetEstudianteDesdeDev() {
  if (currentKardexData && currentKardexData.estudiante && currentKardexData.estudiante.codigo_estudiante) {
    window.open(`/carnet.html?carnet=${encodeURIComponent(currentKardexData.estudiante.codigo_estudiante)}`, '_blank');
  } else {
    alert('No hay código de carné disponible para este estudiante.');
  }
}
window.abrirCarnetEstudianteDesdeDev = abrirCarnetEstudianteDesdeDev;

// ============================================================================
// CONFIGURACIONES PÚBLICAS Y REGLAS DE NEGOCIO "EN CALIENTE"
// ============================================================================

window.appConfig = {
  sinpe_monto_minimo: 1000,
  sinpe_monto_maximo: 50000,
  sinpe_montos_sugeridos: '2000,3000,5000,10000',
  estudiante_limite_diario_default: 3000,
  estudiante_permitir_transferencias_default: 1,
  preordenes_hora_corte: '17:00',
  preordenes_anticipacion_minutos: 30,
  preordenes_cancelacion_estudiantes: 1,
  soporte_whatsapp: '50688888888',
  modo_mantenimiento: 0,
  modo_mantenimiento_mensaje: 'Estamos realizando mejoras técnicas en el sistema. Los pedidos y recargas se reanudarán en breve.'
};

async function cargarConfiguracionesPublicas() {
  try {
    const res = await fetch('/api/configuraciones');
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.configuraciones) {
      window.appConfig = data.configuraciones;
      aplicarConfiguracionPublica(window.appConfig);
    }
  } catch (e) {
    console.warn('Error cargando configuraciones públicas:', e);
  }
}

function aplicarConfiguracionPublica(cfg) {
  if (!cfg) return;

  // 1. Modo Mantenimiento
  const enMantenimiento = Number(cfg.modo_mantenimiento) === 1;
  const msgMantenimiento = cfg.modo_mantenimiento_mensaje || 'Estamos realizando mejoras técnicas en el sistema. Los pedidos se reanudarán en breve.';
  
  const parentBanner = document.getElementById('parentMaintenanceBanner');
  const parentText = document.getElementById('parentMaintenanceBannerText');
  if (parentBanner) {
    parentBanner.style.display = enMantenimiento ? 'flex' : 'none';
    if (parentText) parentText.textContent = msgMantenimiento;
  }

  const studentBanner = document.getElementById('studentMaintenanceBanner');
  const studentText = document.getElementById('studentMaintenanceBannerText');
  if (studentBanner) {
    studentBanner.style.display = enMantenimiento ? 'flex' : 'none';
    if (studentText) studentText.textContent = msgMantenimiento;
  }

  // 2. Presets de SINPE sugeridos para el padre
  const presetsContainer = document.getElementById('parentSinpePresetsContainer');
  if (presetsContainer && cfg.sinpe_montos_sugeridos) {
    const montos = String(cfg.sinpe_montos_sugeridos)
      .split(',')
      .map(m => parseInt(m.trim(), 10))
      .filter(m => !isNaN(m) && m > 0);
    
    if (montos.length > 0) {
      presetsContainer.innerHTML = montos.map(m => `
        <button type="button" onclick="setParentSinpeMonto(${m})" style="background: white; border: 1px solid #86efac; color: #166534; font-size: 0.74rem; font-weight: 700; padding: 4px 9px; border-radius: 8px; cursor: pointer;">₡${m.toLocaleString('es-CR')}</button>
      `).join('');
    }
  }

  // 3. Monto placeholder y min en SINPE del padre
  const inputSinpe = document.getElementById('inputParentSinpeMonto');
  if (inputSinpe && cfg.sinpe_monto_minimo) {
    inputSinpe.min = cfg.sinpe_monto_minimo;
  }

  // 4. Enlaces dinámicos de WhatsApp
  if (cfg.soporte_whatsapp) {
    const cleanTel = String(cfg.soporte_whatsapp).replace(/[^0-9]/g, '');
    const waUrl = `https://wa.me/${cleanTel}`;
    document.querySelectorAll('.link-soporte-whatsapp').forEach(a => {
      a.href = waUrl;
    });
  }
}

// ==========================================
// CONFIGURADOR DE REGLAS DE NEGOCIO "EN CALIENTE" (DEVELOPER)
// ==========================================

async function cargarReglasNegocioDev() {
  try {
    const res = await fetch('/api/developer/configuraciones');
    if (!res.ok) throw new Error('Error al consultar configuraciones');
    const data = await res.json();
    const cfg = data.configs || {};

    const elMinSinpe = document.getElementById('cfg_sinpe_monto_minimo');
    if (elMinSinpe) elMinSinpe.value = cfg.sinpe_monto_minimo || 1000;

    const elMaxSinpe = document.getElementById('cfg_sinpe_monto_maximo');
    if (elMaxSinpe) elMaxSinpe.value = cfg.sinpe_monto_maximo || 50000;

    const elSugeridos = document.getElementById('cfg_sinpe_montos_sugeridos');
    if (elSugeridos) elSugeridos.value = cfg.sinpe_montos_sugeridos || '2000, 3000, 5000, 10000';

    const elLimiteEst = document.getElementById('cfg_estudiante_limite_diario_default');
    if (elLimiteEst) elLimiteEst.value = cfg.estudiante_limite_diario_default || 3000;

    const elTransfEst = document.getElementById('cfg_estudiante_permitir_transferencias_default');
    if (elTransfEst) elTransfEst.checked = String(cfg.estudiante_permitir_transferencias_default) === '1';

    const elCorte = document.getElementById('cfg_preordenes_hora_corte');
    if (elCorte) elCorte.value = cfg.preordenes_hora_corte || '17:00';

    const elAnticipacion = document.getElementById('cfg_preordenes_anticipacion_minutos');
    if (elAnticipacion) elAnticipacion.value = cfg.preordenes_anticipacion_minutos || 30;

    const elCancelEst = document.getElementById('cfg_preordenes_cancelacion_estudiantes');
    if (elCancelEst) elCancelEst.checked = String(cfg.preordenes_cancelacion_estudiantes) !== '0';

    const elWhatsapp = document.getElementById('cfg_soporte_whatsapp');
    if (elWhatsapp) {
      elWhatsapp.value = cfg.soporte_whatsapp || '50688888888';
      actualizarPreviewWhatsapp(elWhatsapp.value);
    }

    const elMantenimiento = document.getElementById('cfg_modo_mantenimiento');
    const isMantenimiento = String(cfg.modo_mantenimiento) === '1';
    if (elMantenimiento) {
      elMantenimiento.checked = isMantenimiento;
      toggleMantenimientoUiState(isMantenimiento);
    }

    const elMsgMantenimiento = document.getElementById('cfg_modo_mantenimiento_mensaje');
    if (elMsgMantenimiento) {
      elMsgMantenimiento.value = cfg.modo_mantenimiento_mensaje || 'Estamos realizando mejoras técnicas en el sistema. Los pedidos y recargas se reanudarán en breve.';
    }
  } catch (err) {
    console.error('Error cargando reglas de negocio dev:', err);
    mostrarAlertaReglasDev(`Error cargando configuraciones: ${err.message}`, false);
  }
}

function actualizarPreviewWhatsapp(val) {
  const preview = document.getElementById('cfgWhatsappPreview');
  if (!preview) return;
  const clean = String(val || '').replace(/[^0-9]/g, '');
  preview.textContent = clean ? `https://wa.me/${clean}` : 'https://wa.me/...';
}

function toggleMantenimientoUiState(activo) {
  const tag = document.getElementById('cfgMantenimientoStatusTag');
  if (!tag) return;
  if (activo) {
    tag.style.background = '#fee2e2';
    tag.style.color = '#b91c1c';
    tag.textContent = '⚠️ ACTIVO - Pausa Operativa';
  } else {
    tag.style.background = '#f1f5f9';
    tag.style.color = '#64748b';
    tag.textContent = 'Desactivado';
  }
}

async function guardarReglasNegocioDev() {
  try {
    const minSinpe = parseInt(document.getElementById('cfg_sinpe_monto_minimo')?.value || 1000, 10);
    const maxSinpe = parseInt(document.getElementById('cfg_sinpe_monto_maximo')?.value || 50000, 10);
    const sugeridos = (document.getElementById('cfg_sinpe_montos_sugeridos')?.value || '2000, 3000, 5000, 10000').trim();
    const limiteEst = parseInt(document.getElementById('cfg_estudiante_limite_diario_default')?.value || 3000, 10);
    const transfEst = document.getElementById('cfg_estudiante_permitir_transferencias_default')?.checked ? '1' : '0';
    const horaCorte = (document.getElementById('cfg_preordenes_hora_corte')?.value || '17:00').trim();
    const anticipacion = parseInt(document.getElementById('cfg_preordenes_anticipacion_minutos')?.value || 30, 10);
    const cancelEst = document.getElementById('cfg_preordenes_cancelacion_estudiantes')?.checked ? '1' : '0';
    const whatsapp = (document.getElementById('cfg_soporte_whatsapp')?.value || '50688888888').trim();
    const mantenimiento = document.getElementById('cfg_modo_mantenimiento')?.checked ? '1' : '0';
    const msgMantenimiento = (document.getElementById('cfg_modo_mantenimiento_mensaje')?.value || '').trim();

    if (minSinpe <= 0) return alert('El monto mínimo de SINPE debe ser mayor a 0');
    if (maxSinpe < minSinpe) return alert('El monto máximo de SINPE debe ser mayor o igual al monto mínimo');

    const updates = {
      sinpe_monto_minimo: String(minSinpe),
      sinpe_monto_maximo: String(maxSinpe),
      sinpe_montos_sugeridos: sugeridos,
      estudiante_limite_diario_default: String(limiteEst),
      estudiante_permitir_transferencias_default: transfEst,
      preordenes_hora_corte: horaCorte,
      preordenes_anticipacion_minutos: String(anticipacion),
      preordenes_cancelacion_estudiantes: cancelEst,
      soporte_whatsapp: whatsapp,
      modo_mantenimiento: mantenimiento,
      modo_mantenimiento_mensaje: msgMantenimiento
    };

    const res = await fetch('/api/developer/configuraciones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar reglas de negocio');

    if (window.sounds) window.sounds.playSuccess();
    mostrarAlertaReglasDev('✅ ¡Reglas de negocio actualizadas y aplicadas en caliente con éxito!', true);

    // Actualizar configuración en la ventana actual
    if (data.configs) {
      window.appConfig = data.configs;
      aplicarConfiguracionPublica(window.appConfig);
    }
  } catch (err) {
    console.error('Error guardando reglas de negocio dev:', err);
    if (window.sounds) window.sounds.playError();
    mostrarAlertaReglasDev(`❌ Error al aplicar cambios: ${err.message}`, false);
  }
}

async function resetearReglasNegocioDev() {
  if (!confirm('¿Deseas restablecer todas las reglas de negocio a sus valores de fábrica recomendados?')) {
    return;
  }

  try {
    const res = await fetch('/api/developer/configuraciones/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al restablecer');

    if (window.sounds) window.sounds.playSuccess();
    mostrarAlertaReglasDev('🔄 Valores de fábrica restablecidos correctamente.', true);
    await cargarReglasNegocioDev();
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    mostrarAlertaReglasDev(`❌ Error: ${err.message}`, false);
  }
}

function mostrarAlertaReglasDev(mensaje, esExito) {
  const alertEl = document.getElementById('devReglasSyncAlert');
  if (!alertEl) return;
  alertEl.style.display = 'flex';
  alertEl.style.background = esExito ? '#ecfdf5' : '#fef2f2';
  alertEl.style.color = esExito ? '#065f46' : '#991b1b';
  alertEl.style.border = `1.5px solid ${esExito ? '#a7f3d0' : '#fecaca'}`;
  alertEl.innerHTML = `<span>${mensaje}</span>`;

  setTimeout(() => {
    alertEl.style.display = 'none';
  }, 4500);
}

window.cargarConfiguracionesPublicas = cargarConfiguracionesPublicas;
window.aplicarConfiguracionPublica = aplicarConfiguracionPublica;
window.cargarReglasNegocioDev = cargarReglasNegocioDev;
window.guardarReglasNegocioDev = guardarReglasNegocioDev;
window.resetearReglasNegocioDev = resetearReglasNegocioDev;
window.actualizarPreviewWhatsapp = actualizarPreviewWhatsapp;
window.toggleMantenimientoUiState = toggleMantenimientoUiState;



