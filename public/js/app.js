// RECREOPAY - LÓGICA DE CLIENTE PWA (ESTUDIANTES Y PADRES)

let students = [];
let currentStudent = null;
let categories = [];
let products = [];
let activeCategoryId = null;
let cart = [];
let currentAppMode = 'kids';

let CLOUDFLARE_TUNNEL_URL = 'https://somewhat-ships-looksmart-optical.trycloudflare.com';

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
  checkHttpsEnvironment();

  // Registrar Service Worker para PWA si está soportado
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(err => console.log('SW error:', err));
  }

  await loadInitialData();
  initStudentSSE();
});

async function loadInitialData() {
  try {
    // 1. Cargar estudiantes
    const resEst = await fetch('/api/estudiantes');
    students = await resEst.json();

    populateStudentSelector();

    // Seleccionar por defecto el primer estudiante (Mateo, 8 años -> Modo Kids)
    if (students.length > 0) {
      await selectStudent(students[0].id);
    }

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

    // Adaptar modo automáticamente por edad (7-10 Kids, 11-15 Teens)
    if (currentStudent.edad <= 10) {
      setAppMode('kids', false);
    } else {
      setAppMode('teens', false);
    }

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

  // Límite diario
  document.getElementById('dailyLimitText').textContent = `₡${currentStudent.limite_diario_colones.toLocaleString('es-CR')}`;
  document.getElementById('dailyAvailableText').textContent = `Disponible hoy: ₡${currentStudent.disponible_hoy.toLocaleString('es-CR')}`;

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

function setAppMode(mode, playSound = true) {
  currentAppMode = mode;
  document.body.classList.remove('mode-kids', 'mode-teens');

  document.getElementById('btnModeKids').classList.remove('active');
  document.getElementById('btnModeTeens').classList.remove('active');

  const transferBtnText = document.getElementById('transferBtnText');

  if (mode === 'kids') {
    document.body.classList.add('mode-kids');
    document.getElementById('btnModeKids').classList.add('active');
    document.getElementById('balanceLabel').textContent = '💰 Mis Colones para el Recreo';
    document.getElementById('kidsCoinIcon').style.display = 'inline-block';
    document.getElementById('qrBtnText').textContent = 'Mi QR 📱';
    if (transferBtnText) transferBtnText.textContent = 'Pasar Plata 🤝';
  } else {
    document.body.classList.add('mode-teens');
    document.getElementById('btnModeTeens').classList.add('active');
    document.getElementById('balanceLabel').textContent = 'SALDO DISPONIBLE';
    document.getElementById('kidsCoinIcon').style.display = 'none';
    document.getElementById('qrBtnText').textContent = 'Mi QR';
    if (transferBtnText) transferBtnText.textContent = 'Transferir ⚡';
  }

  if (playSound && window.sounds) {
    window.sounds.playCoin();
  }
}

// Renderizado de Categorías
function renderCategories() {
  const bar = document.getElementById('categoriesBar');
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

// Renderizado de Productos del Menú
function renderProducts() {
  const grid = document.getElementById('productsGrid');
  const filterMepOnly = document.getElementById('chkFilterMep').checked;

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

  grid.innerHTML = filtered.map(prod => `
    <div class="product-card">
      <div class="product-icon-wrap">${prod.icono || '🥪'}</div>
      <div>
        ${prod.cumple_mep ? '<span class="badge-mep">🌿 MEP Saludable</span>' : ''}
        <h4 class="product-name">${prod.nombre}</h4>
        <p class="product-desc">${prod.descripcion || ''}</p>
        ${prod.alergenos ? `<div style="font-size: 0.68rem; color: #dc2626; margin-bottom: 4px;">⚠️ Contiene: ${prod.alergenos}</div>` : ''}
      </div>
      <div class="product-footer">
        <span class="product-price">₡${prod.precio_colones.toLocaleString('es-CR')}</span>
        <button class="add-btn" onclick="addToCart(${prod.id})" title="Agregar a mi pre-orden">
          +
        </button>
      </div>
    </div>
  `).join('');
}

// ==========================================
// CARRITO Y PRE-ÓRDENES
// ==========================================

function addToCart(productId) {
  const prod = products.find(p => p.id === productId);
  if (!prod) return;

  const existing = cart.find(item => item.product.id === productId);
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

function closeQrModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('modalQr').style.display = 'none';
}

// ==========================================
// PANEL DE PADRES Y RECARGAS SINPE
// ==========================================

function toggleParentPanel(show, e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('modalPadres').style.display = show ? 'flex' : 'none';
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

      if (window.sounds) window.sounds.playSuccess();
      alert(`✅ Límite diario actualizado a ₡${val.toLocaleString('es-CR')} para ${currentStudent.nombre_completo.split(' ')[0]}`);
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
  document.getElementById('modalTransfer').style.display = 'none';
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

// SSE en tiempo real para estudiantes (notificación si le pasan plata)
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
}
