// RECREOPAY - LÓGICA DE LA TERMINAL DE LA SODA (POS & ESCÁNER)

let posProducts = [];
let posCategories = [];
let posCart = [];
let scannedStudent = null;
let currentTab = 'mostrador';
let sseSource = null;
let videoStream = null;
let isScanningActive = true;
let posMobileActiveView = 'catalog';
let CLOUDFLARE_TUNNEL_URL = 'https://somewhat-ships-looksmart-optical.trycloudflare.com';

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

function switchPosMobileView(view) {
  posMobileActiveView = view;
  const body = document.body;
  const tabCat = document.getElementById('btnMobileNavCatalog');
  const tabCheck = document.getElementById('btnMobileNavCheckout');
  const floatBar = document.getElementById('posFloatingCheckoutBar');

  if (view === 'checkout') {
    body.classList.remove('pos-mobile-view-catalog');
    body.classList.add('pos-mobile-view-checkout');
    if (tabCat) tabCat.classList.remove('active');
    if (tabCheck) tabCheck.classList.add('active');
    if (floatBar) floatBar.style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else {
    body.classList.remove('pos-mobile-view-checkout');
    body.classList.add('pos-mobile-view-catalog');
    if (tabCat) tabCat.classList.add('active');
    if (tabCheck) tabCheck.classList.remove('active');
    updatePosCartUI();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

window.addEventListener('resize', () => {
  if (window.innerWidth > 900) {
    const floatBar = document.getElementById('posFloatingCheckoutBar');
    if (floatBar) floatBar.style.display = 'none';
  } else {
    updatePosCartUI();
  }
});

function checkPosHttpsEnvironment() {
  const isHttp = window.location.protocol !== 'https:' && 
                 window.location.hostname !== 'localhost' && 
                 window.location.hostname !== '127.0.0.1';
  
  if (isHttp) {
    const banner = document.getElementById('posBannerHttpsWarning');
    if (banner) {
      banner.style.display = 'block';
      const link = document.getElementById('posLinkHttpsRedirect');
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
        const link = document.getElementById('posLinkHttpsRedirect');
        if (link && isHttp) {
          link.href = CLOUDFLARE_TUNNEL_URL + window.location.pathname;
        }
      }
    })
    .catch(() => {});
}

document.addEventListener('DOMContentLoaded', async () => {
  checkPosHttpsEnvironment();

  // Registrar Service Worker para Notificaciones PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js?v=12.2').then((reg) => {
      reg.update().catch(() => {});
      if ('Notification' in window && Notification.permission === 'granted') {
        subscribeDeviceToWebPush().catch(() => {});
      }
    }).catch(e => console.log('SW register error:', e));
  }

  await loadCatalog();
  await loadPreOrders();
  await loadSinpeRequests();
  // La cámara se activa bajo demanda al cobrar o identificar, NO al entrar
  initSSE();
  initPistolScanner();
  initQuickProductEvents();

  // Si la URL viene con ?tab=sinpe o ?tab=preordenes, abrir esa pestaña directamente
  const urlTab = new URLSearchParams(window.location.search).get('tab');
  if (urlTab === 'sinpe' || urlTab === 'preordenes') {
    switchPosTab(urlTab);
  }

  // Actualizar estado del botón de notificaciones
  updateNotificationButtonState();

  // Solicitar permiso de notificaciones con cualquier primera interacción táctil/clic
  const promptOnFirstInteraction = () => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then((p) => {
        updateNotificationButtonState();
        if (p === 'granted') subscribeDeviceToWebPush().catch(() => {});
      }).catch(() => {});
    }
    window.removeEventListener('click', promptOnFirstInteraction);
    window.removeEventListener('touchstart', promptOnFirstInteraction);
  };
  window.addEventListener('click', promptOnFirstInteraction, { once: true });
  window.addEventListener('touchstart', promptOnFirstInteraction, { once: true });

  // Inicializar preferencia de auto-impresión de ticket térmico
  const chkAutoPrint = document.getElementById('chkPosAutoPrint');
  if (chkAutoPrint) {
    chkAutoPrint.checked = localStorage.getItem('sibopay_pos_autoprint') === '1';
    chkAutoPrint.addEventListener('change', () => {
      localStorage.setItem('sibopay_pos_autoprint', chkAutoPrint.checked ? '1' : '0');
    });
  }
});

// Cargar catálogo de productos
async function loadCatalog() {
  try {
    let url = '/api/productos';
    const storedUser = localStorage.getItem('sibopay_user') || localStorage.getItem('recreopay_user');
    if (storedUser) {
      try {
        const u = JSON.parse(storedUser);
        if (u && u.escuela_id) {
          url += `?escuela_id=${u.escuela_id}`;
        }
      } catch (e) {}
    }
    const res = await fetch(url);
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
  if (!bar) return;
  const storeIcon = window.SiboPayIcons ? window.SiboPayIcons.getFoodIconBadge('store', 'Todos', 'inline') : '';
  bar.innerHTML = `
    <button class="pos-cat-pill active" onclick="filterPosCat(null, this)">
      ${storeIcon}Todos
    </button>
    ${posCategories.map(c => {
      const catIcon = window.SiboPayIcons ? window.SiboPayIcons.getFoodIconBadge(c.icono, c.nombre, 'inline') : `<span>${c.icono || '🍽️'}</span> `;
      return `
        <button class="pos-cat-pill" onclick="filterPosCat(${c.id}, this)">
          ${catIcon}${c.nombre}
        </button>
      `;
    }).join('')}
  `;
}

let currentPosCatId = null;
let posSearchQuery = '';

function normalizeSearchStr(s) {
  if (!s) return '';
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function matchesProduct(prod, query) {
  if (!query) return true;
  const cleanQ = normalizeSearchStr(query);
  if (!cleanQ) return true;

  // 1. Operadores de precio (ej: <1000, <=1200, >500, >=800)
  const priceOpMatch = cleanQ.match(/^([<>]=?)(\d+)$/);
  if (priceOpMatch) {
    const op = priceOpMatch[1];
    const val = parseInt(priceOpMatch[2], 10);
    if (op === '<') return prod.precio_colones < val;
    if (op === '<=') return prod.precio_colones <= val;
    if (op === '>') return prod.precio_colones > val;
    if (op === '>=') return prod.precio_colones >= val;
  }

  // 2. Filtros especiales por palabras clave
  if (cleanQ === 'saludable' || cleanQ === 'nutritivo') {
    return Boolean(prod.cumple_mep || prod.es_saludable);
  }
  if (cleanQ === 'bloqueado' || cleanQ === 'agotado' || cleanQ === 'sin stock') {
    return Boolean(prod.disponible === 0 || (prod.control_stock === 1 && prod.stock <= 0));
  }
  if (cleanQ === 'disponible' || cleanQ === 'en stock') {
    return Boolean(prod.disponible === 1 && (!prod.control_stock || prod.stock > 0));
  }

  // 3. Coincidencia por precio numérico exacto o parcial
  if (/^\d+$/.test(cleanQ)) {
    const pStr = String(prod.precio_colones);
    if (pStr === cleanQ || pStr.includes(cleanQ)) return true;
  }

  // 4. Búsqueda multi-término inteligente (nombre, categoría, descripción, emoji)
  const tokens = cleanQ.split(/\s+/).filter(Boolean);
  const targetStr = normalizeSearchStr(
    `${prod.nombre || ''} ${prod.categoria_nombre || ''} ${prod.descripcion || ''} ${prod.icono || ''} ${prod.precio_colones || ''}`
  );

  return tokens.every(token => targetStr.includes(token));
}

function handlePosSearchInput(val) {
  posSearchQuery = val || '';
  const clearBtn = document.getElementById('posSearchClearBtn');
  if (clearBtn) clearBtn.style.display = posSearchQuery.trim() ? 'inline-flex' : 'none';
  renderPosProducts(currentPosCatId);
}

function clearPosSearch() {
  posSearchQuery = '';
  const input = document.getElementById('posProductSearch');
  if (input) {
    input.value = '';
    input.focus();
  }
  const clearBtn = document.getElementById('posSearchClearBtn');
  if (clearBtn) clearBtn.style.display = 'none';
  const statsEl = document.getElementById('posSearchStats');
  if (statsEl) statsEl.style.display = 'none';
  renderPosProducts(currentPosCatId);
}

function handlePosSearchKeyDown(e) {
  if (e.key === 'Escape') {
    clearPosSearch();
    e.target.blur();
    return;
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    const grid = document.getElementById('posProductsGrid');
    if (!grid) return;
    const firstMatchCard = grid.querySelector('.pos-prod-card:not(.out-of-stock-pos)');
    if (firstMatchCard) {
      firstMatchCard.click();
      if (window.sounds) window.sounds.playCoin();
      clearPosSearch();
    }
  }
}

function filterPosCat(catId, btn) {
  currentPosCatId = catId;
  document.querySelectorAll('#posCategoriesBar .pos-cat-pill').forEach(b => b.classList.remove('active'));
  if (btn) {
    btn.classList.add('active');
  } else if (catId === null) {
    const firstPill = document.querySelector('#posCategoriesBar .pos-cat-pill');
    if (firstPill) firstPill.classList.add('active');
  }
  renderPosProducts(catId);
}

function renderPosProducts(catId) {
  const grid = document.getElementById('posProductsGrid');
  if (!grid) return;

  const hasSearch = Boolean(posSearchQuery && posSearchQuery.trim());
  let list = posProducts;

  // Filtrado compuesto: búsqueda inteligente y categoría
  if (hasSearch) {
    list = list.filter(p => matchesProduct(p, posSearchQuery));
    if (catId !== null) {
      list = list.filter(p => p.categoria_id === catId);
    }
  } else if (catId !== null) {
    list = list.filter(p => p.categoria_id === catId);
  }

  // Barra informativa de estado de búsqueda
  const statsEl = document.getElementById('posSearchStats');
  const statsText = document.getElementById('posSearchStatsText');
  if (statsEl && statsText) {
    if (hasSearch) {
      statsEl.style.display = 'flex';
      const catLabel = catId !== null 
        ? `en categoría "${(posCategories.find(c => c.id === catId) || {}).nombre || ''}"` 
        : 'en todo el catálogo';
      statsText.innerHTML = `Mostrando <strong>${list.length}</strong> de <strong>${posProducts.length}</strong> productos ${catLabel}`;
    } else {
      statsEl.style.display = 'none';
    }
  }

  // Estado cuando no hay productos coincidentes
  if (list.length === 0) {
    if (hasSearch) {
      const safeQuery = posSearchQuery.replace(/"/g, '&quot;').trim();
      grid.innerHTML = `
        <div class="pos-search-empty-state">
          <span style="font-size: 2.2rem; display: block; margin-bottom: 8px;">🔍</span>
          <h4>No se encontraron productos para "${safeQuery}"</h4>
          <p>Verifica el nombre, precio o intenta buscando en otra categoría.</p>
          <div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin-top: 14px;">
            <button type="button" class="btn-saas btn-saas-outline" onclick="clearPosSearch()">Limpiar búsqueda</button>
            ${catId !== null ? `<button type="button" class="btn-saas btn-saas-outline" onclick="filterPosCat(null)">Buscar en todas las categorías</button>` : ''}
            <button type="button" class="btn-saas btn-saas-primary" onclick="openQuickProductModal('${safeQuery}')">
              <span>⚡</span> + Crear "${safeQuery}" como Rápido
            </button>
          </div>
        </div>
      `;
    } else {
      grid.innerHTML = '<p style="grid-column: 1 / -1; text-align: center; color: #64748b; padding: 40px; font-size: 0.9rem;">No hay productos disponibles en esta categoría.</p>';
    }
    return;
  }

  grid.innerHTML = list.map((prod, idx) => {
    const isOutOfStock = prod.disponible === 0 || (prod.control_stock === 1 && prod.stock <= 0);
    const isFirstMatch = hasSearch && idx === 0 && !isOutOfStock;

    const iconBadge = window.SiboPayIcons ? window.SiboPayIcons.getFoodIconBadge(prod.icono, prod.nombre, 'card') : `<div style="font-size: 2.2rem; text-align: center; margin-bottom: 6px;">${prod.icono || '🥪'}</div>`;

    const mediaHtml = prod.imagen_url
      ? `<div style="width: 100%; height: 95px; border-radius: 9px; overflow: hidden; margin-bottom: 8px; background: #f8fafc; border: 1px solid #e2e8f0; position: relative; display: flex; align-items: center; justify-content: center;">
           <img src="${prod.imagen_url}" alt="${prod.nombre}" style="width: 100%; height: 100%; object-fit: cover; display: block;" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';">
           <div style="display: none; width: 100%; height: 100%; align-items: center; justify-content: center;">
             ${iconBadge}
           </div>
         </div>`
      : iconBadge;

    return `
      <div class="pos-prod-card ${isOutOfStock ? 'out-of-stock-pos' : ''} ${isFirstMatch ? 'search-match-first' : ''}" 
           title="${isFirstMatch ? 'Primer resultado coincidente (pulsa Enter para cobrar)' : ''}"
           onclick="${isOutOfStock ? `alert('El producto \\'${prod.nombre.replace(/'/g, "\\'")}\\' se encuentra bloqueado o agotado.')` : `addToPosCart(${prod.id})`}">
        ${isOutOfStock ? '<div style="position: absolute; top: 10px; right: 10px;"><span class="saas-status-badge saas-status-blocked"><span class="saas-dot"></span>BLOQUEADO</span></div>' : (isFirstMatch ? '<div style="position: absolute; top: 8px; right: 8px;"><span class="saas-status-badge saas-status-active" style="font-size: 0.65rem; padding: 2px 6px;">Enter ↵</span></div>' : '')}
        ${mediaHtml}
        <div>
          <div class="prod-title">${prod.nombre}</div>
          ${isOutOfStock ? '<span style="font-size: 0.68rem; color: #dc2626; display: block; margin-top: 2px; font-weight: 700;">No disponible</span>' : ''}
        </div>
        <div class="prod-price" style="color: ${isOutOfStock ? '#94a3b8' : '#0284c7'};">
          ₡${prod.precio_colones.toLocaleString('es-CR')}
        </div>
      </div>
    `;
  }).join('');
}

// ==========================================
// NUEVO PRODUCTO RÁPIDO EN CALIENTE (POS)
// ==========================================

function openQuickProductModal(defaultName = '') {
  const modal = document.getElementById('modalProductoRapido');
  if (!modal) return;
  modal.style.display = 'flex';
  const inputNom = document.getElementById('inputQuickProdNombre');
  const inputPre = document.getElementById('inputQuickProdPrecio');
  if (inputNom) {
    inputNom.value = defaultName ? String(defaultName).trim() : '';
    setTimeout(() => {
      if (defaultName) {
        if (inputPre) inputPre.focus();
      } else {
        inputNom.focus();
      }
    }, 80);
  }
  if (inputPre) inputPre.value = '';
}

function closeQuickProductModal() {
  const modal = document.getElementById('modalProductoRapido');
  if (modal) modal.style.display = 'none';
}

function initQuickProductEvents() {
  const inputNom = document.getElementById('inputQuickProdNombre');
  const inputPre = document.getElementById('inputQuickProdPrecio');

  if (inputNom) {
    inputNom.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (inputPre) inputPre.focus();
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('modalProductoRapido');
      if (modal && modal.style.display !== 'none') {
        closeQuickProductModal();
      }
    }
  });
}

async function saveQuickProduct(e) {
  if (e) e.preventDefault();
  const inputNom = document.getElementById('inputQuickProdNombre');
  const inputPre = document.getElementById('inputQuickProdPrecio');
  const btn = document.getElementById('btnSubmitQuickProd');

  const nombre = inputNom ? inputNom.value.trim() : '';
  const precio = inputPre ? parseInt(inputPre.value, 10) : 0;

  if (!nombre) {
    alert('Ingresa el nombre del producto');
    if (inputNom) inputNom.focus();
    return;
  }
  if (!precio || isNaN(precio) || precio <= 0) {
    alert('Ingresa un precio válido en colones');
    if (inputPre) inputPre.focus();
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>⏳</span> Guardando...';
  }

  try {
    const res = await fetch('/api/productos/rapido', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, precio_colones: precio })
    });
    const data = await res.json();

    if (!res.ok || !data.success || !data.producto) {
      throw new Error(data.error || 'No se pudo guardar el producto');
    }

    const nuevoProd = data.producto;

    // Agregar al catálogo en memoria de la terminal de primero
    const exists = posProducts.find(p => p.id === nuevoProd.id);
    if (!exists) {
      posProducts.unshift(nuevoProd);
    }

    // Re-renderizar productos del mostrador
    renderPosProducts(currentPosCatId);

    // Agregar de inmediato 1 unidad al carrito de cobro
    addToPosCart(nuevoProd.id);

    // Cerrar modal
    closeQuickProductModal();

    if (window.sounds) window.sounds.playCoin();
  } catch (err) {
    alert('Error al registrar producto: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>💾</span> Guardar y Cobrar ➔';
    }
  }
}

// Carrito de mostrador
function addToPosCart(prodId) {
  const prod = posProducts.find(p => p.id === prodId);
  if (!prod) return;

  if (prod.disponible === 0 || (prod.control_stock === 1 && prod.stock <= 0)) {
    alert(`El producto "${prod.nombre}" no está disponible o se encuentra agotado.`);
    return;
  }

  const existing = posCart.find(i => i.product.id === prodId);
  const currentInCart = existing ? existing.cantidad : 0;
  if (prod.control_stock === 1 && (currentInCart + 1) > prod.stock) {
    alert(`Solo quedan ${prod.stock} unidad(es) de "${prod.nombre}" en inventario.`);
    return;
  }

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
  const totalItems = posCart.reduce((sum, item) => sum + item.cantidad, 0);

  // Actualizar badge móvil
  const mobileBadge = document.getElementById('mobileCartBadge');
  if (mobileBadge) {
    if (totalItems > 0) {
      mobileBadge.textContent = totalItems;
      mobileBadge.style.display = 'inline-block';
    } else {
      mobileBadge.style.display = 'none';
    }
  }

  const floatBar = document.getElementById('posFloatingCheckoutBar');
  const floatText = document.getElementById('posFloatingCartText');
  const floatTotal = document.getElementById('posFloatingCartTotal');

  if (posCart.length === 0) {
    list.innerHTML = `
      <div style="text-align: center; padding: 26px 16px; background: #f8fafc; border-radius: 12px; border: 1.5px dashed #cbd5e1;">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 6px;"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
        <p style="margin: 0; font-weight: 800; color: #475569; font-size: 0.85rem;">Mostrador vacío</p>
        <span style="font-size: 0.74rem; color: #94a3b8;">Toca productos del menú para cobrar</span>
      </div>
    `;
    totalEl.textContent = '₡0';
    if (floatBar) floatBar.style.display = 'none';
    return;
  }

  let total = 0;
  list.innerHTML = posCart.map((item, idx) => {
    const subtotal = item.product.precio_colones * item.cantidad;
    total += subtotal;
    const itemBadge = window.SiboPayIcons
      ? window.SiboPayIcons.getFoodIconBadge(item.product.icono, item.product.nombre, 'badge')
      : '';
    return `
      <div class="pos-cart-item">
        <div style="display: flex; align-items: center; min-width: 0; flex: 1;">
          ${itemBadge}
          <div style="min-width: 0; flex: 1; word-break: break-word;">
            <strong style="color: #0f172a; font-size: 0.88rem; font-weight: 800; display: block; line-height: 1.25;">${item.product.nombre}</strong>
            <div style="font-size: 0.74rem; color: #64748b; font-weight: 600; margin-top: 2px;">₡${item.product.precio_colones.toLocaleString('es-CR')} c/u</div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
          <button onclick="changePosQty(${idx}, -1)" class="pos-qty-btn" title="Disminuir">−</button>
          <span style="font-weight: 800; min-width: 20px; text-align: center; color: #0f172a; font-size: 0.9rem;">${item.cantidad}</span>
          <button onclick="changePosQty(${idx}, 1)" class="pos-qty-btn" title="Aumentar">+</button>
          <span style="font-weight: 900; color: #0284c7; min-width: 65px; text-align: right; font-size: 0.92rem;">₡${subtotal.toLocaleString('es-CR')}</span>
        </div>
      </div>
    `;
  }).join('');

  totalEl.textContent = `₡${total.toLocaleString('es-CR')}`;

  // Controlar barra flotante en móvil
  if (floatBar && window.innerWidth <= 900) {
    if (totalItems > 0 && posMobileActiveView === 'catalog') {
      floatBar.style.display = 'flex';
      if (floatText) floatText.textContent = `${totalItems} ${totalItems === 1 ? 'ítem' : 'ítems'} en mostrador`;
      if (floatTotal) floatTotal.textContent = `₡${total.toLocaleString('es-CR')}`;
    } else {
      floatBar.style.display = 'none';
    }
  }
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
// ==========================================
// CÁMARA Y ESCÁNER QR BAJO DEMANDA (EN MODAL)
// ==========================================

let posModalMode = 'cobro'; // 'cobro' | 'identificar' | 'preorden'
let modalVideoStream = null;
let modalQrScanningInterval = null;
let isModalScanningActive = false;
let modalCanvas = null;
let modalCanvasCtx = null;
let lastScannedToken = null;
let lastScannedTime = 0;

async function startModalCamera(isUserAction = false) {
  const video = document.getElementById('modalScannerVideo');
  const badge = document.getElementById('modalCameraStatusBadge');
  const overlay = document.getElementById('modalCameraOverlay');
  const helpText = document.getElementById('modalCameraHelpText');

  stopModalCamera();

  if (!video) return;

  const isHttp = window.location.protocol !== 'https:' && 
                 window.location.hostname !== 'localhost' && 
                 window.location.hostname !== '127.0.0.1';

  if (isHttp || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (badge) badge.textContent = '⚠️ Requiere HTTPS';
    if (overlay) {
      overlay.style.display = 'flex';
      if (helpText) {
        helpText.innerHTML = `
          <div style="font-weight: 800; color: #fca5a5; font-size: 0.85rem; margin-bottom: 4px;">⚠️ Cámara requiere HTTPS</div>
          <span style="font-size: 0.74rem; color: #cbd5e1;">Para acceder a la cámara en vivo en dispositivos remotos o celulares se requiere conexión segura HTTPS. Toca el botón:</span>
          <button type="button" onclick="window.location.href='${CLOUDFLARE_TUNNEL_URL}' + window.location.pathname" style="margin-top: 8px; padding: 8px 14px; background: #10b981; color: white; border: none; border-radius: 8px; font-weight: 800; font-size: 0.8rem; cursor: pointer;">
            🚀 Cambiar a HTTPS Seguro
          </button>
        `;
      }
    }
    return;
  }

  try {
    if (badge) {
      badge.textContent = '📷 Conectando cámara...';
      badge.style.background = 'rgba(15, 23, 42, 0.92)';
      badge.style.borderColor = '#0284c7';
      badge.style.color = '#38bdf8';
    }
    if (overlay) overlay.style.display = 'none';

    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.setAttribute('autoplay', 'true');

    const constraintConfigs = [
      { video: { facingMode: { ideal: posFacingMode }, width: { ideal: 1280 } }, audio: false },
      { video: { facingMode: { ideal: posFacingMode } }, audio: false },
      { video: { facingMode: posFacingMode }, audio: false },
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
      throw lastError || new Error('No se pudo acceder a la cámara');
    }

    modalVideoStream = stream;
    video.srcObject = stream;

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
      console.warn('Reproducción diferida de cámara POS:', playErr);
    }

    if (badge) badge.textContent = '📷 Apunta el carné a la cámara o dispara pistola';
    if (overlay) overlay.style.display = 'none';

    startModalQrDetection(video);
  } catch (err) {
    console.warn('Error accediendo a cámara modal:', err);
    let userMsg = 'Toca el botón para permitir el uso de la cámara.';
    const errName = err.name || '';

    if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
      userMsg = '🔒 Permiso denegado: Habilita el permiso de cámara en la barra de direcciones del navegador.';
    } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
      userMsg = '📷 No se detectó ninguna cámara disponible en este dispositivo.';
    } else if (errName === 'NotReadableError' || errName === 'TrackStartError') {
      userMsg = '⚠️ La cámara está ocupada por otra app. Ciérrala e intenta de nuevo.';
    }

    if (badge) badge.textContent = '⚪ Cámara inactiva';
    if (overlay) {
      overlay.style.display = 'flex';
      if (helpText) {
        helpText.innerHTML = `
          <div style="font-weight: 800; color: #fca5a5; font-size: 0.8rem; margin-bottom: 4px;">⚠️ Permiso Requerido</div>
          <span style="font-size: 0.72rem; color: #f1f5f9;">${userMsg}</span>
        `;
      }
    }
  }
}

function stopModalCamera() {
  isModalScanningActive = false;
  if (modalQrScanningInterval) {
    cancelAnimationFrame(modalQrScanningInterval);
    modalQrScanningInterval = null;
  }
  if (modalVideoStream) {
    modalVideoStream.getTracks().forEach(t => t.stop());
    modalVideoStream = null;
  }
  const video = document.getElementById('modalScannerVideo');
  if (video) {
    video.srcObject = null;
  }
}

function startModalQrDetection(video) {
  if (!modalCanvas) {
    modalCanvas = document.createElement('canvas');
    modalCanvasCtx = modalCanvas.getContext('2d', { willReadFrequently: true });
  }

  isModalScanningActive = true;
  if (modalQrScanningInterval) {
    cancelAnimationFrame(modalQrScanningInterval);
  }

  function scanFrame() {
    if (isModalScanningActive && video && video.readyState === video.HAVE_ENOUGH_DATA) {
      modalCanvas.width = video.videoWidth;
      modalCanvas.height = video.videoHeight;
      modalCanvasCtx.drawImage(video, 0, 0, modalCanvas.width, modalCanvas.height);
      const imageData = modalCanvasCtx.getImageData(0, 0, modalCanvas.width, modalCanvas.height);

      if (window.jsQR) {
        const code = window.jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert'
        });
        if (code && code.data) {
          const now = Date.now();
          if (code.data !== lastScannedToken || (now - lastScannedTime) > 2000) {
            lastScannedToken = code.data;
            lastScannedTime = now;
            onQrCodeDetected(code.data);
            return; // Detener loop de escaneo inmediatamente
          }
        }
      }
    }
    if (isModalScanningActive) {
      modalQrScanningInterval = requestAnimationFrame(scanFrame);
    }
  }

  modalQrScanningInterval = requestAnimationFrame(scanFrame);
}

function simulateScan(qrToken) {
  onQrCodeDetected(qrToken);
}

async function onQrCodeDetected(token) {
  // 1. APAGAR LA CÁMARA DE INMEDIATO - DEJA DE GRABAR
  stopModalCamera();

  // 2. Indicador sonoro y visual de lectura correcta
  if (window.sounds) window.sounds.playScanChirp();

  const badge = document.getElementById('modalCameraStatusBadge');
  if (badge) {
    badge.textContent = '✅ ¡QR Detectado Exitosamente!';
    badge.style.background = '#065f46';
    badge.style.borderColor = '#10b981';
    badge.style.color = '#34d399';
  }

  // Ocultar caja de cámara para que sea evidente que ya terminó de grabar
  const camBox = document.getElementById('modalCameraContainer');
  if (camBox) {
    camBox.style.display = 'none';
  }

  // 3. Procesar según el modo en el que se abrió el modal
  if (posModalMode === 'preorden') {
    await dispatchPreOrderExpress(token);
    closePistolaModal();
    return;
  }

  if (posModalMode === 'identificar' || posCart.length === 0) {
    try {
      const res = await fetch(`/api/estudiantes/qr/${encodeURIComponent(token)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      scannedStudent = data;
      renderScannedStudent();
      if (window.sounds) window.sounds.playSuccess();
      closePistolaModal();

      if (data.preordenes_pendientes && data.preordenes_pendientes.length > 0) {
        if (confirm(`🔔 ¡Atención! ${data.nombre_completo} tiene ${data.preordenes_pendientes.length} pre-orden lista para retirar. ¿Deseas verla y entregarla ahora?`)) {
          switchPosTab('preordenes');
        }
      }
    } catch (err) {
      if (window.sounds) window.sounds.playError();
      alert(`⚠️ Estudiante no reconocido: ${err.message}`);
      resetPistolaModalWaiting();
    }
    return;
  }

  // Modo cobro (posCart.length > 0): Ejecutar cobro inmediato
  await handlePistolBarcodeScan(token);
}

function openStudentIdModal() {
  openPistolaModal('identificar');
}

function openPreOrderScanModal() {
  openPistolaModal('preorden');
}

function renderScannedStudent() {
  const placeholder = document.getElementById('posNoStudentPlaceholder');
  if (!scannedStudent) {
    if (placeholder) placeholder.style.display = 'block';
    document.getElementById('studentScannedCard').style.display = 'none';
    document.getElementById('scannedAllergyAlert').style.display = 'none';
    return;
  }

  if (placeholder) placeholder.style.display = 'none';

  const scannedAvatar = document.getElementById('scannedAvatar');
  if (scannedAvatar) {
    if (scannedAvatar.tagName === 'IMG') {
      scannedAvatar.src = scannedStudent.foto_url || '/img/avatar_default.png';
    } else {
      scannedAvatar.textContent = getStudentInitials(scannedStudent.nombre_completo);
    }
  }
  
  const btnCobrar = document.getElementById('btnCobrarPos');
  if (scannedStudent.tarjeta_bloqueada) {
    document.getElementById('scannedName').innerHTML = `${scannedStudent.nombre_completo} <span style="font-size: 0.72rem; color: #991b1b; background: #fee2e2; border: 1px solid #fecaca; padding: 2px 7px; border-radius: 6px; font-weight: 800; margin-left: 6px;">⛔ SUSPENDIDA</span>`;
    if (btnCobrar) {
      btnCobrar.disabled = true;
      btnCobrar.textContent = '⛔ Tarjeta Suspendida';
      btnCobrar.style.background = '#94a3b8';
      btnCobrar.style.cursor = 'not-allowed';
    }
  } else {
    document.getElementById('scannedName').textContent = scannedStudent.nombre_completo;
    if (btnCobrar) {
      btnCobrar.disabled = false;
      btnCobrar.innerHTML = `<span>⚡</span> COBRAR A ${scannedStudent.nombre_completo.split(' ')[0].toUpperCase()} ➔`;
      btnCobrar.style.background = '#16a34a';
      btnCobrar.style.cursor = 'pointer';
    }
  }

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

  // En pantallas móviles, mostrar la vista de caja automáticamente
  if (window.innerWidth <= 900) {
    switchPosMobileView('checkout');
  }
}

function clearScannedStudent() {
  scannedStudent = null;
  renderScannedStudent();
  const btnCobrar = document.getElementById('btnCobrarPos');
  if (btnCobrar) {
    btnCobrar.disabled = false;
    btnCobrar.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> <span>COBRAR CON PISTOLA QR</span>`;
    btnCobrar.style.background = '#0f172a';
    btnCobrar.style.cursor = 'pointer';
  }
}

// ==========================================
// PISTOLA LECTORA DE QR (USB/BLUETOOTH) Y COBRO RÁPIDO
// ==========================================

let barcodeBuffer = '';
let barcodeLastTime = 0;
let pistolaAutoCloseTimer = null;

function initPistolScanner() {
  // Listener global para capturar ráfagas rápidas de pistola USB/Bluetooth
  window.addEventListener('keydown', (e) => {
    // Si presiona Escape, cerrar modal de cobro si está abierto
    if (e.key === 'Escape') {
      closePistolaModal();
      return;
    }

    // Atajo rápido: Presionar '/' fuera de campos de texto enfoca el buscador de productos
    if (e.key === '/' && document.activeElement && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
      e.preventDefault();
      switchPosTab('mostrador');
      const searchInput = document.getElementById('posProductSearch');
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
      return;
    }

    // Si presiona Enter y el modal está en pantalla de éxito, cerrarlo para el siguiente
    const modalSuccess = document.getElementById('pistolaStateSuccess');
    if (e.key === 'Enter' && modalSuccess && modalSuccess.style.display !== 'none') {
      e.preventDefault();
      closePistolaModal();
      return;
    }

    const now = Date.now();
    // Si pasaron más de 80ms entre teclas, no es pistola, es un humano escribiendo
    if (now - barcodeLastTime > 80 && barcodeBuffer.length > 0) {
      barcodeBuffer = '';
    }
    barcodeLastTime = now;

    if (e.key === 'Enter') {
      if (barcodeBuffer.trim().length >= 3) {
        e.preventDefault();
        const code = barcodeBuffer.trim();
        barcodeBuffer = '';
        handlePistolBarcodeScan(code);
        return;
      }
    } else if (e.key.length === 1) {
      barcodeBuffer += e.key;
    }
  });

  // Listener para el input de texto del modal
  const inputScan = document.getElementById('inputPistolaDirectScan');
  if (inputScan) {
    inputScan.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = inputScan.value.trim();
        if (val.length >= 3) {
          inputScan.value = '';
          handlePistolBarcodeScan(val);
        }
      }
    });
  }
}

function openPistolaModal(mode = 'cobro') {
  posModalMode = mode;

  if (posModalMode === 'cobro' && posCart.length === 0) {
    if (window.sounds) window.sounds.playError();
    alert('⚠️ Selecciona al menos un producto en el mostrador para cobrar.');
    return;
  }

  const modal = document.getElementById('modalPistolaCobro');
  if (!modal) return;

  const totalContainer = document.getElementById('pistolaTotalContainer');
  const title = document.getElementById('pistolaModalTitle');
  const icon = document.getElementById('pistolaModalIcon');

  if (posModalMode === 'cobro') {
    const total = posCart.reduce((sum, item) => sum + (item.product.precio_colones * item.cantidad), 0);
    const totalItems = posCart.reduce((sum, item) => sum + item.cantidad, 0);

    if (totalContainer) totalContainer.style.display = 'block';
    document.getElementById('pistolaModalTotal').textContent = `₡${total.toLocaleString('es-CR')}`;
    document.getElementById('pistolaModalItemCount').textContent = `${totalItems} ${totalItems === 1 ? 'producto' : 'productos'} en mostrador`;
    if (title) title.textContent = 'Cobro con QR / Pistola';
    if (icon) icon.textContent = '💳';
  } else if (posModalMode === 'identificar') {
    if (totalContainer) totalContainer.style.display = 'none';
    if (title) title.textContent = 'Identificar Alumno por QR';
    if (icon) icon.textContent = '👤';
  } else if (posModalMode === 'preorden') {
    if (totalContainer) totalContainer.style.display = 'none';
    if (title) title.textContent = 'Despachar Pre-Orden con QR';
    if (icon) icon.textContent = '📦';
  }

  resetPistolaModalWaiting();
  modal.style.display = 'flex';

  // Mostrar el contenedor de cámara e inicializar stream bajo demanda
  const camBox = document.getElementById('modalCameraContainer');
  if (camBox) camBox.style.display = 'flex';

  startModalCamera();

  // Notificar al teléfono vinculado que la caja está lista para escanear
  try {
    const total = posModalMode === 'cobro' ? posCart.reduce((sum, item) => sum + (item.product.precio_colones * item.cantidad), 0) : 0;
    const totalItems = posCart.reduce((sum, item) => sum + item.cantidad, 0);
    fetch('/api/pos/notify-scan-ready', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: posModalMode, total, itemsCount: totalItems })
    }).catch(() => {});
  } catch (e) {}

  setTimeout(() => {
    const input = document.getElementById('inputPistolaDirectScan');
    if (input) input.focus();
  }, 100);

  if (window.sounds) window.sounds.playTap();
}

function closePistolaModal(e) {
  if (e && e.target && e.target.id !== 'modalPistolaCobro') return;
  if (pistolaAutoCloseTimer) {
    clearTimeout(pistolaAutoCloseTimer);
    pistolaAutoCloseTimer = null;
  }
  // SIEMPRE apagar la cámara de inmediato al salir del modal
  stopModalCamera();

  // Notificar al teléfono vinculado que la sesión de escaneo terminó
  try {
    fetch('/api/pos/notify-scan-cancel', { method: 'POST' }).catch(() => {});
  } catch (e) {}

  const modal = document.getElementById('modalPistolaCobro');
  if (modal) modal.style.display = 'none';
}

function resetPistolaModalWaiting() {
  if (pistolaAutoCloseTimer) {
    clearTimeout(pistolaAutoCloseTimer);
    pistolaAutoCloseTimer = null;
  }
  document.getElementById('pistolaStateWaiting').style.display = 'block';
  document.getElementById('pistolaStateProcessing').style.display = 'none';
  document.getElementById('pistolaStateSuccess').style.display = 'none';
  document.getElementById('pistolaStateError').style.display = 'none';

  const camBox = document.getElementById('modalCameraContainer');
  if (camBox) camBox.style.display = 'flex';

  const badge = document.getElementById('modalCameraStatusBadge');
  if (badge) {
    badge.textContent = '📷 Apunta el carné a la cámara o dispara pistola';
    badge.style.background = 'rgba(15, 23, 42, 0.92)';
    badge.style.borderColor = '#0284c7';
    badge.style.color = '#38bdf8';
  }

  const input = document.getElementById('inputPistolaDirectScan');
  if (input) {
    input.value = '';
    input.focus();
  }
}

async function handlePistolBarcodeScan(rawToken) {
  const token = String(rawToken).trim();
  if (!token) return;

  // Garantizar que la cámara se apague de inmediato
  stopModalCamera();

  if (window.sounds) window.sounds.playScanChirp();

  // Si no hay productos en el carrito, identificar al alumno para mostrador
  if (posCart.length === 0) {
    try {
      const res = await fetch(`/api/estudiantes/qr/${encodeURIComponent(token)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      scannedStudent = data;
      renderScannedStudent();
      if (window.sounds) window.sounds.playSuccess();
      closePistolaModal();
    } catch (err) {
      if (window.sounds) window.sounds.playError();
      alert(`⚠️ Estudiante no reconocido: ${err.message}`);
    }
    return;
  }

  // SI HAY PRODUCTOS EN EL CARRITO: EJECUTAR COBRO INMEDIATO CON PISTOLA
  const modal = document.getElementById('modalPistolaCobro');
  if (modal && modal.style.display === 'none') {
    modal.style.display = 'flex';
  }

  // Mostrar estado de procesamiento
  document.getElementById('pistolaStateWaiting').style.display = 'none';
  document.getElementById('pistolaStateError').style.display = 'none';
  document.getElementById('pistolaStateSuccess').style.display = 'none';
  document.getElementById('pistolaStateProcessing').style.display = 'block';
  document.getElementById('pistolaProcessingName').textContent = 'Identificando estudiante y validando monedero...';

  try {
    // 1. Buscar estudiante por token o código
    const resEst = await fetch(`/api/estudiantes/qr/${encodeURIComponent(token)}`);
    const student = await resEst.json();
    if (!resEst.ok) throw new Error(student.error || 'Carné escolar no encontrado');

    document.getElementById('pistolaProcessingName').textContent = `Verificando saldo para ${student.nombre_completo}...`;

    // 2. Validar si la tarjeta está suspendida
    if (student.tarjeta_bloqueada) {
      throw new Error(`⛔ TARJETA SUSPENDIDA: La tarjeta de ${student.nombre_completo} ha sido bloqueada por la administración de la soda.`);
    }

    // 3. Validar saldo disponible y límite diario
    const totalCompra = posCart.reduce((sum, item) => sum + (item.product.precio_colones * item.cantidad), 0);
    
    if (student.saldo_colones < totalCompra) {
      throw new Error(`⚠️ SALDO INSUFICIENTE: ${student.nombre_completo} tiene ₡${student.saldo_colones.toLocaleString('es-CR')} de saldo y la compra es de ₡${totalCompra.toLocaleString('es-CR')}.`);
    }

    if (student.disponible_hoy < totalCompra) {
      throw new Error(`⚠️ SUPERA LÍMITE DIARIO: Le quedan ₡${student.disponible_hoy.toLocaleString('es-CR')} disponibles hoy de su límite diario asignado.`);
    }

    // 4. Procesar cobro en servidor
    const items = posCart.map(item => ({
      producto_id: item.product.id,
      cantidad: item.cantidad
    }));

    const resCobro = await fetch('/api/ordenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        estudiante_id: student.id,
        tipo_orden: 'mostrador',
        momento_entrega: 'inmediato',
        items
      })
    });

    const dataCobro = await resCobro.json();
    if (!resCobro.ok) throw new Error(dataCobro.error || 'Error al procesar el débito');

    // 5. Éxito: Mostrar pantalla de confirmación
    document.getElementById('pistolaStateProcessing').style.display = 'none';
    document.getElementById('pistolaStateSuccess').style.display = 'block';

    document.getElementById('pistolaSuccessStudent').textContent = student.nombre_completo;
    document.getElementById('pistolaSuccessTicket').textContent = dataCobro.codigo_orden;
    document.getElementById('pistolaSuccessAmount').textContent = `₡${totalCompra.toLocaleString('es-CR')}`;
    const nuevoSaldo = (dataCobro.financiero && dataCobro.financiero.estudiante) 
      ? dataCobro.financiero.estudiante.saldo_nuevo 
      : (student.saldo_colones - totalCompra);
    document.getElementById('pistolaSuccessBalance').textContent = `₡${nuevoSaldo.toLocaleString('es-CR')}`;

    if (window.sounds) {
      window.sounds.playSuccess();
      window.sounds.playCoin();
    }

    // Guardar para impresión de comanda / ticket térmico
    window.lastCompletedOrder = {
      orderCode: dataCobro.codigo_orden || ('ORD-' + Date.now().toString().slice(-4)),
      student: {
        nombre_completo: student.nombre_completo,
        codigo_estudiante: student.codigo_estudiante,
        grado: student.grado || student.grado_seccion || ''
      },
      items: posCart.map(i => ({
        nombre: i.product?.nombre || 'Producto',
        cantidad: i.cantidad || 1,
        precio: i.product?.precio || 0,
        subtotal: (i.product?.precio || 0) * (i.cantidad || 1)
      })),
      total: totalCompra,
      nuevoSaldo: nuevoSaldo,
      fecha: new Date()
    };

    // Auto-imprimir ticket si está activada la casilla
    const autoPrintActive = !!document.getElementById('chkPosAutoPrint')?.checked;
    if (autoPrintActive) {
      setTimeout(() => {
        imprimirTicketTermico();
      }, 350);
    }

    // Limpiar carrito de mostrador
    clearPosCart();
    clearScannedStudent();

    // Auto-cerrar el modal (dar más tiempo si se imprime para no interrumpir el diálogo)
    const closeDelay = autoPrintActive ? 6000 : 2500;
    pistolaAutoCloseTimer = setTimeout(() => {
      closePistolaModal();
    }, closeDelay);

  } catch (err) {
    if (window.sounds) window.sounds.playError();
    document.getElementById('pistolaStateProcessing').style.display = 'none';
    document.getElementById('pistolaStateError').style.display = 'block';
    document.getElementById('pistolaErrorTitle').textContent = 'No se pudo realizar el cobro';
    document.getElementById('pistolaErrorDesc').textContent = err.message;
  }
}

// Ejecutar cobro en mostrador (desde botón principal)
async function executePosDebit() {
  if (posCart.length === 0) {
    if (window.sounds) window.sounds.playError();
    alert('⚠️ Selecciona al menos un producto en el mostrador para cobrar.');
    return;
  }

  // Si ya tenemos un estudiante identificado previamente, cobramos directamente
  if (scannedStudent) {
    await handlePistolBarcodeScan(scannedStudent.qr_token || scannedStudent.codigo_estudiante);
    return;
  }

  // Si no hay estudiante previo, abrir modal esperando el disparo de la pistola QR
  openPistolaModal();
}

// ==========================================
// FILA RÁPIDA DE PRE-ÓRDENES
// ==========================================

function switchPosTab(tab) {
  currentTab = tab;
  document.getElementById('tabBtnMostrador').classList.toggle('active', tab === 'mostrador');
  document.getElementById('tabBtnPreordenes').classList.toggle('active', tab === 'preordenes');
  const tabSinpe = document.getElementById('tabBtnSinpe');
  if (tabSinpe) tabSinpe.classList.toggle('active', tab === 'sinpe');

  document.getElementById('viewPosMostrador').style.display = tab === 'mostrador' ? 'block' : 'none';
  document.getElementById('viewPosPreordenes').style.display = tab === 'preordenes' ? 'block' : 'none';
  const viewSinpe = document.getElementById('viewPosSinpe');
  if (viewSinpe) viewSinpe.style.display = tab === 'sinpe' ? 'block' : 'none';

  if (tab === 'preordenes') {
    loadPreOrders();
  } else if (tab === 'sinpe') {
    loadSinpeRequests();
  }
}

let currentPreOrderFilter = 'todos';
let cachedPreOrders = [];

function normalizeMomentoKey(val) {
  if (!val) return 'recreo_1';
  const v = String(val).toLowerCase().trim();
  if (v === 'recreo_1' || v.includes('1er') || v.includes('9:30')) return 'recreo_1';
  if (v === 'almuerzo' || v.includes('almuerzo') || v.includes('11:45')) return 'almuerzo';
  if (v === 'recreo_2' || v.includes('2do') || v.includes('1:45')) return 'recreo_2';
  if (v === 'inmediato' || v.includes('inmediato')) return 'inmediato';
  return v;
}

function getMomentoBadge(val) {
  const key = normalizeMomentoKey(val);
  switch (key) {
    case 'recreo_1':
      return {
        key: 'recreo_1',
        title: '1er Recreo (9:30 AM)',
        full: '1er Recreo de la Mañana (9:30 AM)',
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
        title: 'Almuerzo (11:45 AM)',
        full: 'Hora de Almuerzo (11:45 AM)',
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
        title: '2do Recreo (1:45 PM)',
        full: '2do Recreo de la Tarde (1:45 PM)',
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
        badgeBg: '#e0f2fe',
        badgeColor: '#0369a1',
        badgeBorder: '#bae6fd'
      };
  }
}

function filterPreOrdersByMomento(key) {
  currentPreOrderFilter = key;
  renderPreOrdersList();
}

function renderPreOrdersList() {
  const orders = cachedPreOrders || [];

  // Conteo total de pendientes
  const pendingOrders = orders.filter(o => o.estado !== 'entregado' && o.estado !== 'cancelado');
  const countTodosPending = pendingOrders.length;
  
  const badgeCount = document.getElementById('badgePreordenesCount');
  if (badgeCount) badgeCount.textContent = countTodosPending;

  // Conteo por cada horario de entrega
  let countR1 = 0, countAlm = 0, countR2 = 0;
  pendingOrders.forEach(o => {
    const k = normalizeMomentoKey(o.momento_entrega);
    if (k === 'recreo_1') countR1++;
    else if (k === 'almuerzo') countAlm++;
    else if (k === 'recreo_2') countR2++;
  });

  const elTodos = document.getElementById('countFilterTodos');
  const elR1 = document.getElementById('countFilterRecreo1');
  const elAlm = document.getElementById('countFilterAlmuerzo');
  const elR2 = document.getElementById('countFilterRecreo2');
  if (elTodos) elTodos.textContent = countTodosPending;
  if (elR1) elR1.textContent = countR1;
  if (elAlm) elAlm.textContent = countAlm;
  if (elR2) elR2.textContent = countR2;

  // Actualizar clase activa en los botones de filtro
  const pillMap = {
    'todos': 'filterPillTodos',
    'recreo_1': 'filterPillRecreo_1',
    'almuerzo': 'filterPillAlmuerzo',
    'recreo_2': 'filterPillRecreo_2'
  };
  Object.keys(pillMap).forEach(k => {
    const btn = document.getElementById(pillMap[k]);
    if (btn) btn.classList.toggle('active', currentPreOrderFilter === k);
  });

  // Filtrar según botón seleccionado
  let filtered = orders;
  if (currentPreOrderFilter !== 'todos') {
    filtered = orders.filter(o => normalizeMomentoKey(o.momento_entrega) === currentPreOrderFilter);
  }

  const list = document.getElementById('preOrdersList');
  if (!list) return;

  if (filtered.length === 0) {
    const filterNames = {
      'todos': 'para hoy',
      'recreo_1': 'para el 1er Recreo (9:30 AM)',
      'almuerzo': 'para el Almuerzo (11:45 AM)',
      'recreo_2': 'para el 2do Recreo (1:45 PM)'
    };
    list.innerHTML = `
      <div style="text-align: center; color: #64748b; padding: 40px 20px; background: white; border-radius: 14px; border: 1.5px dashed #cbd5e1; margin-top: 4px;">
        <span style="font-size: 2.2rem; display: block; margin-bottom: 8px;">🥪</span>
        <strong style="color: #334155; font-size: 0.95rem; display: block;">No hay pre-órdenes registradas ${filterNames[currentPreOrderFilter] || ''}</strong>
        <p style="font-size: 0.8rem; margin: 4px 0 0 0; color: #94a3b8;">Las órdenes programadas para este horario aparecerán aquí automáticamente.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = filtered.map(ord => {
    const hora = new Date(ord.creado_en).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' });
    const items = Array.isArray(ord.items) ? ord.items : [];
    const itemsList = items.map(i => `${i.cantidad}× ${i.nombre}`).join(' • ');
    const badge = getMomentoBadge(ord.momento_entrega);

    return `
      <div class="pos-preorder-card" style="border-left: 6px solid ${badge.border};">
        <!-- Banner Superior de Horario Programado -->
        <div class="pos-preorder-badge-banner" style="background: ${badge.bg}; border: 1.5px solid ${badge.badgeBorder}; color: ${badge.text};">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 1.3rem;">${badge.icon}</span>
            <div>
              <span style="font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.85; display: block; font-weight: 800;">ALISTAR PARA:</span>
              <strong style="font-size: 0.96rem; letter-spacing: -0.2px;">${badge.full}</strong>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            ${ord.estado === 'entregado'
              ? '<span class="saas-status-badge saas-status-active" style="padding: 4px 10px; font-weight: 800;"><span class="saas-dot"></span>Entregado</span>'
              : '<span class="saas-status-badge saas-status-pending" style="padding: 4px 10px; background: #fef08a; color: #854d0e; border: 1px solid #fde047; font-weight: 800;"><span class="saas-dot" style="background: #eab308;"></span>Pendiente Alistar</span>'
            }
          </div>
        </div>

        <div class="pos-preorder-header" style="margin-top: 2px;">
          <div class="pos-preorder-student">
            <div class="pos-preorder-avatar" style="display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 0.9rem; background: linear-gradient(135deg, #0284c7, #0369a1); color: #ffffff;">
              ${getStudentInitials(ord.estudiante_nombre)}
            </div>
            <div>
              <div class="pos-preorder-name-row">
                <strong class="pos-preorder-name">${ord.estudiante_nombre}</strong>
                <span class="pos-preorder-grade">${ord.grado} • ${ord.seccion}</span>
              </div>
              <div class="pos-preorder-ticket-info" style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <span>Ticket: <strong>${ord.codigo_orden}</strong></span>
                <span>•</span>
                <span>Pedido: ${hora}</span>
                <span>•</span>
                <span style="color: ${badge.text}; font-weight: 800;">Retiro: ${badge.title}</span>
              </div>
            </div>
          </div>
        </div>

        ${ord.notas ? `
          <div style="background: #fef3c7; border: 1px solid #fde68a; color: #92400e; padding: 6px 10px; border-radius: 8px; font-size: 0.78rem; font-weight: 700;">
            📝 Nota del pedido: ${ord.notas}
          </div>
        ` : ''}

        <div class="pos-preorder-items-box" style="display: flex; align-items: center; gap: 8px;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
          <span style="flex: 1; word-break: break-word;">${itemsList}</span>
        </div>

        <div class="pos-preorder-footer">
          <div class="pos-preorder-total">
            <span class="pos-preorder-total-label">Total Cobrado:</span>
            <strong class="pos-preorder-total-val">₡${ord.total_colones.toLocaleString('es-CR')}</strong>
          </div>
          <div>
            ${ord.estado !== 'entregado' ? `
              <button onclick="updateOrderStatus(${ord.id}, 'entregado')" class="btn-saas pos-btn-entregar" title="Marcar como entregado al estudiante">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                <span>Entregar Pedido</span>
              </button>
            ` : `
              <span class="saas-status-badge saas-status-active" style="padding: 6px 12px; font-size: 0.8rem;">
                <span class="saas-dot"></span>Despachado en Soda
              </span>
            `}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function loadPreOrders() {
  try {
    const res = await fetch('/api/ordenes?tipo=preorden');
    const orders = await res.json();

    if (!Array.isArray(orders)) {
      console.warn('Respuesta no válida al cargar pre-órdenes:', orders);
      return;
    }

    cachedPreOrders = orders;
    renderPreOrdersList();
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

    const badge = getMomentoBadge(data.orden ? data.orden.momento_entrega : '');
    const itemsList = (data.orden && Array.isArray(data.orden.items) ? data.orden.items : []).map(i => `• ${i.cantidad}x ${i.nombre}`).join('\n');
    alert(`¡ENTREGA EXPRESS EXITOSA!\n${data.mensaje}\nAlumno: ${data.estudiante.nombre_completo}\nGrado: ${data.estudiante.grado}\nHorario: ${badge.title}\n\nProductos a entregar:\n${itemsList}`);

    loadPreOrders();
  } catch (err) {
    alert(err.message);
  }
}

function showPreOrderIncomingNotification(orden) {
  const badge = getMomentoBadge(orden.momento_entrega);
  const container = document.createElement('div');
  container.className = 'pos-incoming-preorder-toast';
  container.style.borderLeft = `6px solid ${badge.border}`;
  
  container.innerHTML = `
    <div style="font-size: 1.8rem; flex-shrink: 0;">${badge.icon}</div>
    <div style="flex: 1; min-width: 0;">
      <div style="display: flex; align-items: center; gap: 6px;">
        <strong style="color: #0f172a; font-size: 0.92rem;">¡Nueva Pre-orden Recibida!</strong>
        <span style="background: ${badge.badgeBg}; color: ${badge.badgeColor}; border: 1px solid ${badge.badgeBorder}; padding: 1px 7px; border-radius: 6px; font-size: 0.72rem; font-weight: 800;">
          ${badge.title}
        </span>
      </div>
      <div style="font-size: 0.8rem; color: #475569; margin-top: 2px;">
        <strong>${orden.estudiante_nombre || 'Estudiante'}</strong> (${orden.grado || ''}) • ₡${(orden.total_colones || 0).toLocaleString('es-CR')}
      </div>
    </div>
    <button type="button" onclick="switchPosTab('preordenes'); this.closest('.pos-incoming-preorder-toast').remove();" class="btn-saas btn-saas-primary" style="padding: 6px 12px; font-size: 0.78rem; border-radius: 8px; flex-shrink: 0;">
      Ver
    </button>
    <button type="button" onclick="this.closest('.pos-incoming-preorder-toast').remove();" style="background: none; border: none; font-size: 1.1rem; color: #94a3b8; cursor: pointer; padding: 4px;">✕</button>
  `;

  document.body.appendChild(container);
  setTimeout(() => {
    if (container.parentNode) {
      container.style.opacity = '0';
      container.style.transform = 'translateX(100%)';
      container.style.transition = 'all 0.3s ease';
      setTimeout(() => container.remove(), 300);
    }
  }, 6000);
}

// ==========================================
// SSE (SERVER-SENT EVENTS EN TIEMPO REAL)
// ==========================================

function initSSE() {
  sseSource = new EventSource('/api/events');

  sseSource.addEventListener('nueva_orden', (e) => {
    try {
      const orden = JSON.parse(e.data);
      if (window.sounds) window.sounds.playSuccess();
      loadPreOrders();
      if (orden && orden.tipo_orden === 'preorden') {
        showPreOrderIncomingNotification(orden);
      }
    } catch (err) {
      console.warn('Error en SSE nueva_orden:', err);
    }
  });

  sseSource.addEventListener('orden_actualizada', () => {
    loadPreOrders();
  });

  // Disparo recibido desde pistola remota (teléfono celular)
  sseSource.addEventListener('pistola_scan', async (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data && data.token) {
        console.log('📡 [POS] Disparo recibido desde pistola remota (teléfono):', data.token);

        // Feedback visual en la barra superior
        const badge = document.getElementById('pistolaStatusBadge');
        if (badge) {
          const prevHtml = badge.innerHTML;
          badge.innerHTML = `<span class="saas-dot" style="background: #10b981;"></span> 📱 Disparo: ${data.token}`;
          badge.style.background = '#dcfce7';
          badge.style.borderColor = '#86efac';
          badge.style.color = '#15803d';
          setTimeout(() => {
            badge.innerHTML = prevHtml;
            badge.style.background = '#e0f2fe';
            badge.style.borderColor = '#bae6fd';
            badge.style.color = '#0369a1';
          }, 2500);
        }

        // Ejecutar procesamiento del carné escaneado
        await onQrCodeDetected(data.token);
      }
    } catch (err) {
      console.error('Error procesando disparo remoto:', err);
    }
  });

  sseSource.addEventListener('producto_actualizado', (e) => {
    try {
      const prod = JSON.parse(e.data);
      const idx = posProducts.findIndex(p => p.id === prod.id);
      if (idx !== -1) {
        if (prod.eliminado) {
          posProducts.splice(idx, 1);
        } else {
          posProducts[idx] = { ...posProducts[idx], ...prod };
        }
      } else if (!prod.eliminado) {
        posProducts.push(prod);
      }
      renderPosProducts(currentPosCatId);
    } catch (err) {
      console.error('Error procesando producto_actualizado en POS:', err);
    }
  });

  sseSource.addEventListener('estudiante_actualizado', (e) => {
    try {
      const data = JSON.parse(e.data);
      const estId = data.id || data.estudiante_id;
      if (scannedStudent && scannedStudent.id === estId) {
        if (typeof data.saldo_colones === 'number') scannedStudent.saldo_colones = data.saldo_colones;
        if (typeof data.disponible_hoy === 'number') scannedStudent.disponible_hoy = data.disponible_hoy;
        renderScannedStudent();
      }
    } catch (err) {}
  });

  sseSource.addEventListener('saldo_actualizado', (e) => {
    try {
      const data = JSON.parse(e.data);
      const estId = data.id || data.estudiante_id;
      if (scannedStudent && scannedStudent.id === estId) {
        if (typeof data.saldo_colones === 'number') scannedStudent.saldo_colones = data.saldo_colones;
        if (typeof data.disponible_hoy === 'number') scannedStudent.disponible_hoy = data.disponible_hoy;
        renderScannedStudent();
      }
    } catch (err) {}
  });

  sseSource.addEventListener('solicitud_sinpe_nueva', (e) => {
    try {
      const sol = JSON.parse(e.data);
      const montoFmt = (sol.monto_colones || 0).toLocaleString('es-CR');
      const estudianteNombre = sol.estudiante_nombre || 'Estudiante';
      const comp = sol.comprobante_sinpe || '';

      // 1. Notificación flotante en la aplicación (con vibración y sonido de moneda)
      showInAppNotification({
        title: '¡Nueva Recarga SINPE Reportada!',
        message: `<strong>${estudianteNombre}</strong>: ₡${montoFmt} • Comp #${comp}`,
        buttonText: 'Ver y Aprobar'
      });

      // 2. Notificación PUSH del navegador / sistema operativo
      sendPushNotification('🔔 Nueva Recarga SINPE - SiboPay', {
        body: `Se reportó una recarga de ₡${montoFmt} para ${estudianteNombre}. Comprobante: #${comp}`,
        tag: `sinpe-${sol.id || Date.now()}`,
        data: { url: '/pos.html?tab=sinpe' }
      });

      loadSinpeRequests();
    } catch (err) {
      console.error('Error procesando solicitud_sinpe_nueva en POS:', err);
    }
  });

  sseSource.addEventListener('solicitud_sinpe_procesada', () => {
    loadSinpeRequests();
  });
}

// ==========================================
// SISTEMA DE NOTIFICACIONES PUSH & EN-APP (RECARGAS SINPE)
// ==========================================
function updateNotificationButtonState() {
  const btn = document.getElementById('btnPosNotificationToggle');
  const lbl = document.getElementById('lblPosNotificationStatus');
  if (!btn || !lbl) return;

  if (!('Notification' in window)) {
    btn.style.display = 'none';
    return;
  }

  if (Notification.permission === 'granted') {
    btn.style.color = '#16a34a';
    btn.style.borderColor = '#86efac';
    btn.style.background = '#f0fdf4';
    lbl.textContent = 'Notificaciones Activas';
    btn.title = 'Notificaciones push y avisos en pantalla activos';
  } else if (Notification.permission === 'denied') {
    btn.style.color = '#dc2626';
    btn.style.borderColor = '#fca5a5';
    btn.style.background = '#fef2f2';
    lbl.textContent = 'Notificaciones Bloqueadas';
    btn.title = 'Las notificaciones están bloqueadas en los ajustes del navegador';
  } else {
    btn.style.color = '#0284c7';
    btn.style.borderColor = '#bae6fd';
    btn.style.background = 'white';
    lbl.textContent = 'Activar Notificaciones';
    btn.title = 'Toca para recibir avisos de recargas SINPE';
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
    console.log('[WebPush] PushManager no soportado en este navegador');
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

    let user = null;
    try {
      const stored = localStorage.getItem('sibopay_user') || localStorage.getItem('recreopay_user');
      if (stored) user = JSON.parse(stored);
    } catch (e) {}

    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: sub,
        userId: user ? user.id : null,
        rol: user ? user.rol : 'cajero',
        escuelaId: user ? user.escuela_id : 1
      })
    });

    console.log('[WebPush] Dispositivo registrado exitosamente para alertas con app cerrada');
    return sub;
  } catch (err) {
    console.warn('[WebPush] Error suscribiendo dispositivo a Web Push:', err);
    return null;
  }
}

async function enablePushNotificationsPrompt() {
  if (!('Notification' in window)) {
    alert('Tu navegador no soporta notificaciones de sistema.');
    return;
  }

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;

  if (isIOS && !isStandalone) {
    alert('📱 Consejo para iPhone (iOS):\nPara recibir notificaciones aun con la app cerrada, toca Compartir en Safari (icono de cuadrado con flecha arriba) y selecciona "Agregar al inicio". Desde el icono en la pantalla de inicio recibirás las alertas siempre.');
  }

  if (Notification.permission === 'granted') {
    await subscribeDeviceToWebPush();
    showInAppNotification({
      title: '¡Notificaciones Activas!',
      message: 'Recibirás avisos sonoros y en pantalla de bloqueo incluso con la app cerrada cada vez que un padre envíe una recarga SINPE.',
      buttonText: 'Entendido'
    });
    return;
  }

  try {
    const perm = await Notification.requestPermission();
    updateNotificationButtonState();
    if (perm === 'granted') {
      await subscribeDeviceToWebPush();
      sendPushNotification('🔔 SiboPay Terminal Soda', {
        body: '¡Notificaciones activadas! Te avisaremos al instante con cada recarga SINPE, aun con la app cerrada.',
        tag: 'sibopay-welcome'
      });
      showInAppNotification({
        title: '¡Notificaciones Activadas!',
        message: 'Avisos en pantalla y notificaciones de fondo con app cerrada activadas correctamente.',
        buttonText: 'Listo'
      });
    } else {
      alert('Las notificaciones no fueron autorizadas. Puedes activarlas desde el candado de la barra de direcciones.');
    }
  } catch (err) {
    console.error('Error solicitando permisos de notificación:', err);
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

function showInAppNotification({ title, message, buttonText = 'Ver y Aprobar', url = null }) {
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
    if (typeof switchPosTab === 'function') {
      switchPosTab('sinpe');
    } else if (url) {
      window.location.href = url;
    }
  };

  // Vibrar en dispositivos móviles
  if ('vibrate' in navigator) {
    try { navigator.vibrate([200, 100, 200]); } catch (e) {}
  }

  // Sonido de recarga
  if (window.sounds && window.sounds.playCoin) {
    try { window.sounds.playCoin(); } catch (e) {}
  }

  // Auto cerrar tras 14s
  clearTimeout(window._inAppToastTimer);
  window._inAppToastTimer = setTimeout(dismissInAppToast, 14000);
}

function dismissInAppToast() {
  const toast = document.getElementById('recreoPayInAppToast');
  if (!toast) return;
  toast.classList.add('closing');
  setTimeout(() => toast.remove(), 250);
}

// ==========================================
// RECARGAS SINPE EN POS
// ==========================================

async function loadSinpeRequests() {
  const list = document.getElementById('sinpeRequestsList');
  const badge = document.getElementById('badgeSinpeCount');
  if (!list) return;

  try {
    let url = '/api/sinpe/solicitudes?estado=pendiente';
    const storedUser = localStorage.getItem('sibopay_user') || localStorage.getItem('recreopay_user');
    if (storedUser) {
      try {
        const u = JSON.parse(storedUser);
        if (u && u.escuela_id) url += `&escuela_id=${u.escuela_id}`;
      } catch (e) {}
    }
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const solicitudes = data.solicitudes || [];

    if (badge) {
      if (solicitudes.length > 0) {
        badge.textContent = solicitudes.length;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    }

    if (solicitudes.length === 0) {
      list.innerHTML = `
        <div style="background: white; border: 1.5px dashed #cbd5e1; border-radius: 14px; padding: 48px 20px; text-align: center; color: #64748b;">
          <div style="font-size: 2.5rem; margin-bottom: 8px;">✨</div>
          <strong style="color: #0f172a; font-size: 1.05rem; display: block; margin-bottom: 4px;">No hay recargas SINPE pendientes</strong>
          <p style="font-size: 0.85rem; margin: 0; color: #94a3b8;">Todas las recargas reportadas por los padres han sido procesadas.</p>
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
                  ${s.estudiante_nombre}
                </div>
                <div style="font-size: 0.75rem; color: #64748b; margin-top: 1px; font-weight: 600;">
                  ${s.estudiante_grado || 'Estudiante'} ${s.estudiante_seccion ? '• Sec. ' + s.estudiante_seccion : ''}
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
                  ${s.codigo_detalle || '-'}
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
                  #${s.comprobante_sinpe || '-'}
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
              <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"><strong>Detalle:</strong> ${s.notas}</span>
            </div>
          ` : ''}

          <!-- FILA 3: BOTONES DE ACCIÓN (RECHAZAR / APROBAR) -->
          <div style="display: flex; gap: 8px; align-items: center; width: 100%; border-top: 1px solid #f1f5f9; padding-top: 8px; box-sizing: border-box;">
            <button type="button" onclick="procesarSinpePos(${s.id}, 'rechazar')" style="flex: 0 0 auto; width: 95px; padding: 10px 8px; background: #fff1f2; color: #e11d48; border: 1.5px solid #fecdd3; border-radius: 10px; font-weight: 800; font-size: 0.82rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px; box-sizing: border-box; transition: all 0.15s;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              <span>Rechazar</span>
            </button>
            <button type="button" onclick="procesarSinpePos(${s.id}, 'aprobar')" style="flex: 1 1 0; min-width: 0; padding: 10px 8px; background: linear-gradient(135deg, #16a34a, #15803d); color: white; border: none; border-radius: 10px; font-weight: 900; font-size: 0.86rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 2px 8px rgba(22, 163, 74, 0.25); box-sizing: border-box; transition: all 0.15s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink: 0;"><polyline points="20 6 9 17 4 12"/></svg>
              <span>Aprobar (+₡${s.monto_colones.toLocaleString('es-CR')})</span>
            </button>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Error cargando solicitudes SINPE:', err);
  }
}

async function procesarSinpePos(solicitudId, accion) {
  if (accion === 'aprobar') {
    const ok = confirm('¿Confirmas que verificaste el comprobante y el dinero ya ingresó a la cuenta bancaria de la soda?');
    if (!ok) return;

    try {
      const res = await fetch('/api/sinpe/procesar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          solicitud_id: solicitudId,
          accion: 'aprobar',
          usuario_id: null
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (window.sounds) window.sounds.playCoin();
      alert(`¡Recarga Aprobada!\nSe acreditaron ₡${data.resultado.monto.toLocaleString('es-CR')} al estudiante ${data.resultado.estudiante_nombre}.\nNuevo saldo: ₡${data.resultado.saldo_nuevo.toLocaleString('es-CR')}.`);
      loadSinpeRequests();
    } catch (err) {
      if (window.sounds) window.sounds.playError();
      alert(`Error al aprobar recarga: ${err.message}`);
    }
  } else if (accion === 'rechazar') {
    const motivo = prompt('Motivo del rechazo de la recarga:', 'Comprobante no coincide o fondos no recibidos');
    if (motivo === null) return; // cancelado por usuario

    try {
      const res = await fetch('/api/sinpe/procesar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          solicitud_id: solicitudId,
          accion: 'rechazar',
          motivo: motivo || 'Rechazado por la soda',
          usuario_id: null
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      alert('La solicitud de recarga ha sido rechazada.');
      loadSinpeRequests();
    } catch (err) {
      alert(`Error al rechazar recarga: ${err.message}`);
    }
  }
}

function posLogout() {
  try {
    localStorage.removeItem('sibopay_token');
    localStorage.removeItem('sibopay_user');
    localStorage.removeItem('recreopay_token');
    localStorage.removeItem('recreopay_user');
    sessionStorage.clear();
  } catch (e) {}
  window.location.href = '/index.html?logout=true';
}
window.posLogout = posLogout;

// ==========================================
// VINCULACIÓN DE TELÉFONO COMO PISTOLA QR
// ==========================================

function openPhonePairingModal() {
  const modal = document.getElementById('modalPhonePairing');
  if (!modal) return;
  const pistolaUrl = window.location.origin + '/pistola.html';
  const img = document.getElementById('imgPairingQr');
  const link = document.getElementById('linkDirectPistola');
  if (img) img.src = `/api/qr-image/${encodeURIComponent(pistolaUrl)}`;
  if (link) {
    link.href = pistolaUrl;
  }
  modal.style.display = 'flex';
}
window.openPhonePairingModal = openPhonePairingModal;

function closePhonePairingModal(e) {
  if (e && e.target && e.target.id !== 'modalPhonePairing') return;
  const modal = document.getElementById('modalPhonePairing');
  if (modal) modal.style.display = 'none';
}
window.closePhonePairingModal = closePhonePairingModal;

function copyPistolaUrl() {
  const pistolaUrl = window.location.origin + '/pistola.html';
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(pistolaUrl).then(() => {
      const feedback = document.getElementById('lblCopyPistolaFeedback');
      if (feedback) {
        feedback.style.display = 'block';
        setTimeout(() => { if (feedback) feedback.style.display = 'none'; }, 3000);
      }
    }).catch(() => {
      prompt('Copia este enlace para abrir la pistola en tu teléfono:', pistolaUrl);
    });
  } else {
    prompt('Copia este enlace para abrir la pistola en tu teléfono:', pistolaUrl);
  }
}
window.copyPistolaUrl = copyPistolaUrl;

// ==========================================
// IMPRESIÓN DE COMANDA / TICKET TÉRMICO (58mm / 80mm)
// ==========================================
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function imprimirTicketTermico(orderData) {
  const ord = orderData || window.lastCompletedOrder;
  if (!ord) {
    alert('No hay ninguna venta o comanda reciente para imprimir.');
    return;
  }

  // Si el modal está abierto con auto-cierre, pausar o extender el temporizador
  if (typeof pistolaAutoCloseTimer !== 'undefined' && pistolaAutoCloseTimer) {
    clearTimeout(pistolaAutoCloseTimer);
    pistolaAutoCloseTimer = setTimeout(() => {
      if (typeof closePistolaModal === 'function') closePistolaModal();
    }, 6000);
  }

  const container = document.getElementById('posThermalReceipt');
  if (!container) return;

  const fechaFmt = (ord.fecha ? new Date(ord.fecha) : new Date()).toLocaleString('es-CR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
  });

  const itemsRows = (ord.items || []).map(it => {
    const cant = it.cantidad || 1;
    const subt = (it.subtotal != null ? it.subtotal : ((it.precio || 0) * cant));
    return `
      <tr>
        <td style="padding: 2px 4px 2px 0; vertical-align: top; width: 26px; font-weight: bold;">${cant}x</td>
        <td style="padding: 2px 4px; vertical-align: top; word-break: break-word;">${escapeHtml(it.nombre)}</td>
        <td style="padding: 2px 0 2px 4px; vertical-align: top; text-align: right; white-space: nowrap; font-weight: bold;">₡${Number(subt).toLocaleString('es-CR')}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div style="text-align: center; font-family: 'Courier New', Courier, monospace; font-size: 12px; line-height: 1.25; color: #000; width: 100%; max-width: 80mm; margin: 0 auto; box-sizing: border-box;">
      <div style="font-size: 15px; font-weight: 900; letter-spacing: 0.5px; margin-bottom: 2px;">SIBOPAY</div>
      <div style="font-size: 11px; font-weight: bold; text-transform: uppercase; margin-bottom: 4px;">SODA ESCOLAR • COMPROBANTE</div>
      <div style="border-top: 1px dashed #000; margin: 5px 0;"></div>

      <div style="text-align: left; font-size: 11px; line-height: 1.35;">
        <div><strong>Fecha:</strong> ${fechaFmt}</div>
        <div><strong>Ticket:</strong> #${escapeHtml(ord.orderCode)}</div>
        <div><strong>Estudiante:</strong> ${escapeHtml(ord.student?.nombre_completo || 'Cliente')}</div>
        ${ord.student?.grado ? `<div><strong>Grado:</strong> ${escapeHtml(ord.student.grado)}</div>` : ''}
      </div>

      <div style="border-top: 1px dashed #000; margin: 5px 0;"></div>

      <table style="width: 100%; font-size: 11px; border-collapse: collapse; text-align: left; margin: 4px 0;">
        <thead>
          <tr style="border-bottom: 1px dashed #000;">
            <th style="padding-bottom: 3px; font-weight: bold;">Cant.</th>
            <th style="padding-bottom: 3px; font-weight: bold;">Detalle</th>
            <th style="text-align: right; padding-bottom: 3px; font-weight: bold;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${itemsRows}
        </tbody>
      </table>

      <div style="border-top: 1px dashed #000; margin: 5px 0;"></div>

      <div style="display: flex; justify-content: space-between; font-size: 14px; font-weight: 900; margin: 4px 0;">
        <span>TOTAL COBRADO:</span>
        <span>₡${Number(ord.total || 0).toLocaleString('es-CR')}</span>
      </div>

      <div style="display: flex; justify-content: space-between; font-size: 11px; margin: 2px 0;">
        <span>Saldo Disponible:</span>
        <span style="font-weight: bold;">₡${Number(ord.nuevoSaldo || 0).toLocaleString('es-CR')}</span>
      </div>

      <div style="border-top: 1px dashed #000; margin: 6px 0;"></div>
      <div style="text-align: center; font-size: 10px; margin-top: 6px; line-height: 1.3;">
        ¡Gracias por su compra!<br>
        Monedero Escolar SiboPay
      </div>
    </div>
  `;

  window.print();
}
window.imprimirTicketTermico = imprimirTicketTermico;



