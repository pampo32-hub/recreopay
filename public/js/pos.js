// RECREOPAY - LÓGICA DE LA TERMINAL DE LA SODA (POS & ESCÁNER)

let posProducts = [];
let posCategories = [];
let posCart = [];
let scannedStudent = null;
let currentTab = 'mostrador';
let sseSource = null;
let videoStream = null;
let isScanningActive = true;

document.addEventListener('DOMContentLoaded', async () => {
  await loadCatalog();
  await loadPreOrders();
  initCamera();
  initSSE();
});

// Cargar catálogo de productos
async function loadCatalog() {
  try {
    const res = await fetch('/api/productos');
    const data = await res.json();
    posCategories = data.categorias;
    posProducts = data.productos;

    renderPosCategories();
    renderPosProducts(null);
  } catch (err) {
    console.error('Error cargando catálogo:', err);
  }
}

function renderPosCategories() {
  const bar = document.getElementById('posCategoriesBar');
  bar.innerHTML = `
    <button class="pos-tab-btn active" style="padding: 6px 12px; font-size: 0.8rem;" onclick="filterPosCat(null, this)">Todos</button>
    ${posCategories.map(c => `
      <button class="pos-tab-btn" style="padding: 6px 12px; font-size: 0.8rem;" onclick="filterPosCat(${c.id}, this)">
        ${c.icono} ${c.nombre}
      </button>
    `).join('')}
  `;
}

function filterPosCat(catId, btn) {
  document.querySelectorAll('#posCategoriesBar .pos-tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderPosProducts(catId);
}

function renderPosProducts(catId) {
  const grid = document.getElementById('posProductsGrid');
  let list = posProducts;
  if (catId !== null) {
    list = list.filter(p => p.categoria_id === catId);
  }

  grid.innerHTML = list.map(prod => `
    <div class="pos-prod-card" onclick="addToPosCart(${prod.id})">
      <div style="font-size: 2.2rem; text-align: center;">${prod.icono || '🥪'}</div>
      <div>
        <div style="font-size: 0.88rem; font-weight: 800; color: #ffffff; line-height: 1.2;">${prod.nombre}</div>
        ${prod.cumple_mep ? '<span style="font-size: 0.65rem; color: #34d399;">🌿 MEP Saludable</span>' : ''}
      </div>
      <div style="font-size: 1.1rem; font-weight: 900; color: #38bdf8; margin-top: 6px;">
        ₡${prod.precio_colones.toLocaleString('es-CR')}
      </div>
    </div>
  `).join('');
}

// Carrito de mostrador
function addToPosCart(prodId) {
  const prod = posProducts.find(p => p.id === prodId);
  if (!prod) return;

  const existing = posCart.find(i => i.product.id === prodId);
  if (existing) {
    existing.cantidad++;
  } else {
    posCart.push({ product: prod, cantidad: 1 });
  }

  if (window.sounds) window.sounds.playCoin();
  updatePosCartUI();
}

function updatePosCartUI() {
  const list = document.getElementById('posCartList');
  const totalEl = document.getElementById('posCartTotal');

  if (posCart.length === 0) {
    list.innerHTML = '<p style="text-align: center; color: #64748b; padding: 20px; font-size: 0.85rem;">Toca productos del menú para cobrar</p>';
    totalEl.textContent = '₡0';
    return;
  }

  let total = 0;
  list.innerHTML = posCart.map((item, idx) => {
    const subtotal = item.product.precio_colones * item.cantidad;
    total += subtotal;
    return `
      <div class="pos-cart-item">
        <div style="flex: 1;">
          <strong style="color: #f8fafc; font-size: 0.85rem;">${item.product.icono} ${item.product.nombre}</strong>
          <div style="font-size: 0.75rem; color: #94a3b8;">₡${item.product.precio_colones.toLocaleString('es-CR')} c/u</div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <button onclick="changePosQty(${idx}, -1)" style="width: 24px; height: 24px; background: #334155; color: white; border: none; border-radius: 4px; font-weight: 800; cursor: pointer;">-</button>
          <span style="font-weight: 800; min-width: 14px; text-align: center; color: #ffffff;">${item.cantidad}</span>
          <button onclick="changePosQty(${idx}, 1)" style="width: 24px; height: 24px; background: #334155; color: white; border: none; border-radius: 4px; font-weight: 800; cursor: pointer;">+</button>
          <span style="font-weight: 900; color: #38bdf8; min-width: 55px; text-align: right;">₡${subtotal.toLocaleString('es-CR')}</span>
        </div>
      </div>
    `;
  }).join('');

  totalEl.textContent = `₡${total.toLocaleString('es-CR')}`;
}

function changePosQty(idx, delta) {
  posCart[idx].cantidad += delta;
  if (posCart[idx].cantidad <= 0) {
    posCart.splice(idx, 1);
  }
  updatePosCartUI();
}

function clearPosCart() {
  posCart = [];
  updatePosCartUI();
}

// ==========================================
// ESCÁNER Y LECTURA DE QR
// ==========================================

let posFacingMode = 'environment';
let posQrScanningInterval = null;
let posCanvas = null;
let posCanvasCtx = null;
let lastScannedToken = null;
let lastScannedTime = 0;

async function initCamera(isUserAction = false) {
  const video = document.getElementById('scannerVideo');
  const status = document.getElementById('cameraStatus');
  const overlay = document.getElementById('cameraHelpOverlay');
  const retryBtn = document.getElementById('btnRetryPosCamera');
  const flipBtn = document.getElementById('btnFlipPosCamera');

  if (videoStream) {
    videoStream.getTracks().forEach(t => t.stop());
    videoStream = null;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    status.textContent = '⚠️ Requiere HTTPS';
    if (overlay) {
      overlay.style.display = 'flex';
      document.getElementById('cameraHelpText').textContent = '⚠️ Para usar la cámara en dispositivos remotos se requiere conexión segura HTTPS. Puedes usar los botones de prueba abajo.';
    }
    return;
  }

  try {
    status.textContent = 'Conectando lente...';
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: posFacingMode }, width: { ideal: 1280 } },
        audio: false
      });
    } catch (err1) {
      // Fallback a cualquier cámara disponible
      videoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }

    video.setAttribute('playsinline', 'true');
    video.setAttribute('autoplay', 'true');
    video.muted = true;
    video.srcObject = videoStream;

    await video.play();

    status.textContent = '🟢 Escáner activo';
    if (overlay) overlay.style.display = 'none';
    if (retryBtn) retryBtn.style.display = 'none';
    if (flipBtn) flipBtn.style.display = 'inline-block';

    startUniversalQrDetection(video);
  } catch (err) {
    console.warn('Error accediendo a cámara:', err);
    status.textContent = '⚪ Cámara inactiva';
    if (overlay) {
      overlay.style.display = 'flex';
      document.getElementById('cameraHelpText').textContent = 'Toca Permitir Cámara o habilita los permisos en la barra de direcciones.';
    }
    if (retryBtn) retryBtn.style.display = 'inline-block';
  }
}

function flipPosCamera() {
  posFacingMode = posFacingMode === 'environment' ? 'user' : 'environment';
  initCamera(true);
}

function startUniversalQrDetection(video) {
  if (!posCanvas) {
    posCanvas = document.createElement('canvas');
    posCanvasCtx = posCanvas.getContext('2d', { willReadFrequently: true });
  }

  if (posQrScanningInterval) {
    cancelAnimationFrame(posQrScanningInterval);
  }

  function scanFrame() {
    if (isScanningActive && video.readyState === video.HAVE_ENOUGH_DATA) {
      posCanvas.width = video.videoWidth;
      posCanvas.height = video.videoHeight;
      posCanvasCtx.drawImage(video, 0, 0, posCanvas.width, posCanvas.height);
      const imageData = posCanvasCtx.getImageData(0, 0, posCanvas.width, posCanvas.height);

      if (window.jsQR) {
        const code = window.jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert'
        });
        if (code && code.data) {
          const now = Date.now();
          // Evitar lecturas duplicadas en menos de 2 segundos
          if (code.data !== lastScannedToken || (now - lastScannedTime) > 2000) {
            lastScannedToken = code.data;
            lastScannedTime = now;
            onQrCodeDetected(code.data);
          }
        }
      }
    }
    posQrScanningInterval = requestAnimationFrame(scanFrame);
  }

  posQrScanningInterval = requestAnimationFrame(scanFrame);
}

function simulateScan(qrToken) {
  onQrCodeDetected(qrToken);
}

async function onQrCodeDetected(token) {
  if (window.sounds) window.sounds.playScanChirp();

  // Si estamos en la pestaña de fila rápida de pre-órdenes, despachamos de inmediato
  if (currentTab === 'preordenes') {
    await dispatchPreOrderExpress(token);
    return;
  }

  // Si estamos en mostrador, identificamos al estudiante
  try {
    const res = await fetch(`/api/estudiantes/qr/${encodeURIComponent(token)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    scannedStudent = data;
    renderScannedStudent();

    // Si tiene pre-órdenes listas, alertar a la cajera
    if (data.preordenes_pendientes && data.preordenes_pendientes.length > 0) {
      if (confirm(`🔔 ¡Atención! ${data.nombre_completo} tiene ${data.preordenes_pendientes.length} pre-orden lista para retirar. ¿Deseas verla y entregarla ahora?`)) {
        switchPosTab('preordenes');
      }
    }
  } catch (err) {
    if (window.sounds) window.sounds.playError();
    alert(`QR no reconocido: ${err.message}`);
  }
}

function renderScannedStudent() {
  if (!scannedStudent) {
    document.getElementById('studentScannedCard').style.display = 'none';
    document.getElementById('scannedAllergyAlert').style.display = 'none';
    return;
  }

  document.getElementById('scannedAvatar').src = scannedStudent.foto_url;
  document.getElementById('scannedName').textContent = scannedStudent.nombre_completo;
  document.getElementById('scannedGrade').textContent = `${scannedStudent.grado} • Sección ${scannedStudent.seccion} • Cód: ${scannedStudent.codigo_estudiante}`;
  document.getElementById('scannedBalance').textContent = `₡${scannedStudent.saldo_colones.toLocaleString('es-CR')}`;
  document.getElementById('scannedAvailable').textContent = `₡${scannedStudent.disponible_hoy.toLocaleString('es-CR')}`;
  document.getElementById('studentScannedCard').style.display = 'flex';

  // Alerta médica en mostrador
  const alertBox = document.getElementById('scannedAllergyAlert');
  if (scannedStudent.alergias && scannedStudent.alergias !== 'Ninguna' && scannedStudent.alergias !== 'Ninguna conocida') {
    alertBox.style.display = 'block';
    document.getElementById('scannedAllergyText').textContent = scannedStudent.alergias;
  } else {
    alertBox.style.display = 'none';
  }
}

function clearScannedStudent() {
  scannedStudent = null;
  renderScannedStudent();
}

// Ejecutar cobro en mostrador
async function executePosDebit() {
  if (!scannedStudent) {
    if (window.sounds) window.sounds.playError();
    return alert('⚠️ Primero escanea el carné o celular del estudiante (puedes usar los botones de prueba rápida en la cámara).');
  }

  if (posCart.length === 0) {
    if (window.sounds) window.sounds.playError();
    return alert('⚠️ Selecciona al menos un producto en el mostrador para cobrar.');
  }

  const items = posCart.map(item => ({
    producto_id: item.product.id,
    cantidad: item.cantidad
  }));

  const btn = document.getElementById('btnCobrarPos');
  btn.disabled = true;
  btn.textContent = 'Procesando débito...';

  try {
    const res = await fetch('/api/ordenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        estudiante_id: scannedStudent.id,
        tipo_orden: 'mostrador',
        momento_entrega: 'inmediato',
        items
      })
    });

    const data = await res.json();
    if (!res.ok) {
      if (window.sounds) window.sounds.playError();
      throw new Error(data.error);
    }

    if (window.sounds) window.sounds.playSuccess();

    alert(`✅ ¡COBRO EXITOSO!\nTicket: ${data.codigo_orden}\nEstudiante: ${scannedStudent.nombre_completo}\nMonto: ₡${data.total_colones.toLocaleString('es-CR')}\nNuevo Saldo: ₡${data.financiero.estudiante.saldo_nuevo.toLocaleString('es-CR')}`);

    // Limpiar caja y refrescar
    clearPosCart();
    clearScannedStudent();
  } catch (err) {
    alert(`❌ Fallo en la transacción: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>📱</span> COBRAR CON QR DE ALUMNO';
  }
}

// ==========================================
// FILA RÁPIDA DE PRE-ÓRDENES
// ==========================================

function switchPosTab(tab) {
  currentTab = tab;
  document.getElementById('tabBtnMostrador').classList.toggle('active', tab === 'mostrador');
  document.getElementById('tabBtnPreordenes').classList.toggle('active', tab === 'preordenes');

  document.getElementById('viewPosMostrador').style.display = tab === 'mostrador' ? 'block' : 'none';
  document.getElementById('viewPosPreordenes').style.display = tab === 'preordenes' ? 'block' : 'none';

  if (tab === 'preordenes') {
    loadPreOrders();
  }
}

async function loadPreOrders() {
  try {
    const res = await fetch('/api/ordenes?tipo=preorden');
    const orders = await res.json();

    const pendingCount = orders.filter(o => o.estado !== 'entregado' && o.estado !== 'cancelado').length;
    document.getElementById('badgePreordenesCount').textContent = pendingCount;

    const list = document.getElementById('preOrdersList');
    if (orders.length === 0) {
      list.innerHTML = '<p style="text-align: center; color: #64748b; padding: 30px;">No hay pre-órdenes registradas para hoy.</p>';
      return;
    }

    list.innerHTML = orders.map(ord => {
      const hora = new Date(ord.creado_en).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' });
      const itemsList = ord.items.map(i => `${i.cantidad}x ${i.icono || '🥪'} ${i.nombre}`).join(', ');

      return `
        <div style="background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 14px; display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; gap: 12px; align-items: center;">
            <img src="${ord.foto_url}" style="width: 44px; height: 44px; border-radius: 50%; border: 2px solid #38bdf8;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <strong style="color: #ffffff; font-size: 0.95rem;">${ord.estudiante_nombre}</strong>
                <span style="font-size: 0.75rem; color: #94a3b8;">${ord.grado} - ${ord.seccion}</span>
                <span class="status-pill status-${ord.estado}">${ord.estado}</span>
              </div>
              <div style="font-size: 0.8rem; color: #38bdf8; margin: 2px 0;">📦 ${itemsList}</div>
              <div style="font-size: 0.72rem; color: #94a3b8;">Ticket: ${ord.codigo_orden} • Pedido a las ${hora} • Total: ₡${ord.total_colones.toLocaleString('es-CR')}</div>
            </div>
          </div>

          <div style="display: flex; gap: 8px;">
            ${ord.estado === 'pendiente' ? `
              <button onclick="updateOrderStatus(${ord.id}, 'en_preparacion')" style="padding: 6px 12px; background: #3b82f6; color: white; border: none; border-radius: 8px; font-weight: 700; cursor: pointer;">
                👨‍🍳 Preparar
              </button>
            ` : ''}
            ${ord.estado === 'en_preparacion' ? `
              <button onclick="updateOrderStatus(${ord.id}, 'listo')" style="padding: 6px 12px; background: #10b981; color: white; border: none; border-radius: 8px; font-weight: 700; cursor: pointer;">
                🛍️ Listo en Bolsa
              </button>
            ` : ''}
            ${ord.estado === 'listo' ? `
              <button onclick="updateOrderStatus(${ord.id}, 'entregado')" style="padding: 6px 14px; background: #059669; color: white; border: none; border-radius: 8px; font-weight: 800; cursor: pointer;">
                ✅ Entregar
              </button>
            ` : ''}
            ${ord.estado === 'entregado' ? `
              <span style="font-size: 0.78rem; color: #34d399; font-weight: 800;">✓ Entregado</span>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Error cargando pre-órdenes:', err);
  }
}

async function updateOrderStatus(orderId, nuevoEstado) {
  try {
    const res = await fetch(`/api/ordenes/${orderId}/estado`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: nuevoEstado })
    });
    if (!res.ok) throw new Error('Error actualizando orden');
    if (window.sounds) window.sounds.playCoin();
    loadPreOrders();
  } catch (e) {
    alert(e.message);
  }
}

// Despacho Express en 3 segundos mediante escaneo de QR
async function dispatchPreOrderExpress(qrToken) {
  try {
    const res = await fetch('/api/ordenes/despachar-qr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qr_token: qrToken })
    });

    const data = await res.json();
    if (!res.ok) {
      if (window.sounds) window.sounds.playError();
      throw new Error(data.error);
    }

    if (window.sounds) window.sounds.playSuccess();

    alert(`🎉 ¡ENTREGA EXPRESS EXITOSA!\n${data.mensaje}\nAlumno: ${data.estudiante.nombre_completo}\nGrado: ${data.estudiante.grado}\nProductos a entregar:\n${data.orden.items.map(i => `• ${i.cantidad}x ${i.nombre}`).join('\n')}`);

    loadPreOrders();
  } catch (err) {
    alert(err.message);
  }
}

// ==========================================
// SSE (SERVER-SENT EVENTS EN TIEMPO REAL)
// ==========================================

function initSSE() {
  sseSource = new EventSource('/api/events');

  sseSource.addEventListener('nueva_orden', (e) => {
    const orden = JSON.parse(e.data);
    if (window.sounds) window.sounds.playSuccess();
    // Notificación sonora y visual
    loadPreOrders();
  });

  sseSource.addEventListener('orden_actualizada', () => {
    loadPreOrders();
  });
}
