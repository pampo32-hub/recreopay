/**
 * SiboPay Food & Beverage Vector Icons (SVG)
 * Iconografía vectorial fina, minimalista y elegante para productos escolares y soda
 */

(function (window) {
  'use strict';

  const FOOD_ICONS = {
    'sandwich': {
      label: 'Sandwich / Panini',
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3"/><path d="M12 4C7 4 4 7 4 9h16c0-2-3-5-8-5Z"/><path d="M4 18h16a1 1 0 0 0 1-1v-1H3v1a1 1 0 0 0 1 1Z"/><line x1="3" y1="13" x2="21" y2="13"/></svg>'
    },
    'croissant': {
      label: 'Empanada / Repostería',
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m4.6 13.4 1.8 1.8a2 2 0 0 0 2.8 0l8.4-8.4a2 2 0 0 0 0-2.8l-1.8-1.8a2 2 0 0 0-2.8 0L4.6 10.6a2 2 0 0 0 0 2.8Z"/><path d="m14.5 9.5-6 6"/><path d="M7 17a5 5 0 0 0 7 7 5 5 0 0 0 7-7"/><path d="M3 13a5 5 0 0 0 7-7"/></svg>'
    },
    'utensils': {
      label: 'Plato Fuerte / Almuerzo',
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M18 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/><path d="M6 2v20"/><path d="M3 7V2h6v5a3 3 0 0 1-6 0v0Z"/></svg>'
    },
    'cup-soda': {
      label: 'Bebida / Fresco Natural',
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m6 8 1.75 12.28A2 2 0 0 0 9.73 22h4.54a2 2 0 0 0 1.98-1.72L18 8"/><path d="M5 8h14"/><path d="M7 15a6.47 6.47 0 0 1 5 0 6.47 6.47 0 0 0 5 0"/><path d="m12 8 1-6h2"/></svg>'
    },
    'milk': {
      label: 'Leche / Lácteos',
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2h8"/><path d="M9 2v3a3 3 0 0 1-.88 2.12L7 8.24A4 4 0 0 0 6 11v9a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-9a4 4 0 0 0-1-2.76l-1.12-1.12A3 3 0 0 1 15 5V2"/><line x1="6" y1="15" x2="18" y2="15"/></svg>'
    },
    'coffee': {
      label: 'Café / Infusión Caliente',
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/></svg>'
    },
    'apple': {
      label: 'Fruta / Saludable',
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5c-2.22 0-4 1.44-5 2-1-.56-2.78-2-5-2a4.9 4.9 0 0 0-5 4.78C2 14 5 22 8 22c1.25 0 2.5-1.06 4-1.06Z"/><path d="M10 2c1 .5 2 2 2 5"/></svg>'
    },
    'bowl': {
      label: 'Bowl / Ensalada / Sopa',
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11h16a1 1 0 0 1 1 1 8 8 0 0 1-16 0 1 1 0 0 1 1-1Z"/><path d="M8 7c0-2 2-3 2-5"/><path d="M12 7c0-2 2-3 2-5"/><path d="M16 7c0-2 2-3 2-5"/></svg>'
    },
    'cookie': {
      label: 'Galleta / Snack',
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"/><circle cx="8.5" cy="8.5" r="0.75" fill="currentColor"/><circle cx="7" cy="13.5" r="0.75" fill="currentColor"/><circle cx="12" cy="16" r="0.75" fill="currentColor"/><circle cx="16.5" cy="13" r="0.75" fill="currentColor"/><circle cx="11.5" cy="11.5" r="0.75" fill="currentColor"/></svg>'
    },
    'pizza': {
      label: 'Pizza / Taco / Rápida',
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2-9 18a2.5 2.5 0 0 0 2.2 1.3h13.6a2.5 2.5 0 0 0 2.2-1.3L12 2Z"/><circle cx="12" cy="9.5" r="1" fill="currentColor"/><circle cx="9" cy="15.5" r="1" fill="currentColor"/><circle cx="15" cy="15.5" r="1" fill="currentColor"/></svg>'
    },
    'meat': {
      label: 'Carne / Pollo / Proteína',
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m15.4 15.4-3.9 3.9a5.5 5.5 0 1 1-7.8-7.8l3.9-3.9a5.5 5.5 0 0 1 7.8 7.8Z"/><path d="m14 10 4-4"/><circle cx="19" cy="5" r="1.5"/></svg>'
    },
    'wheat': {
      label: 'Cereal / Granola / Avena',
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m2 22 10-10"/><path d="M16 8a4 4 0 0 0-6 0 4 4 0 0 0 0 6 4 4 0 0 0 6 0 4 4 0 0 0 0-6Z"/><path d="M19 5a4 4 0 0 0-6 0 4 4 0 0 0 0 6 4 4 0 0 0 6 0 4 4 0 0 0 0-6Z"/></svg>'
    },
    'ice-cream': {
      label: 'Postre / Gelatina / Helado',
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m7 11 5 11 5-11"/><path d="M12 2a5 5 0 0 0-5 5v4h10V7a5 5 0 0 0-5-5Z"/></svg>'
    },
    'store': {
      label: 'Todos / Menú Completo',
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20"/></svg>'
    }
  };

  // Mapeo automático de emojis antiguos a iconos SVG elegantes
  const EMOJI_TO_KEY = {
    '🥪': 'sandwich',
    '🥟': 'croissant',
    '🌮': 'pizza',
    '🍳': 'utensils',
    '🍗': 'meat',
    '🍛': 'utensils',
    '🍹': 'cup-soda',
    '🥤': 'cup-soda',
    '🧃': 'cup-soda',
    '🥛': 'milk',
    '🍉': 'apple',
    '🥣': 'bowl',
    '🌾': 'wheat',
    '🍮': 'ice-cream',
    '🍎': 'apple',
    '🍕': 'pizza',
    '🥗': 'bowl',
    '🍪': 'cookie',
    '🍽️': 'utensils',
    '☕': 'coffee',
    '🥩': 'meat',
    '🍦': 'ice-cream',
    '🥑': 'apple',
    '🥐': 'croissant',
    '🍞': 'sandwich',
    '🍔': 'sandwich'
  };

  /**
   * Resuelve el identificador de icono SVG a partir de una clave, emoji o nombre de producto
   */
  function resolveIconKey(rawInput, fallbackName) {
    if (!rawInput && !fallbackName) return 'sandwich';
    const input = String(rawInput || '').trim();

    // 1. Si coincide directamente con una clave conocida
    if (FOOD_ICONS[input]) return input;

    // 2. Si coincide con un emoji mapeado
    if (EMOJI_TO_KEY[input]) return EMOJI_TO_KEY[input];

    // 3. Analizar palabras clave en el nombre del producto
    const text = (String(fallbackName || '') + ' ' + input).toLowerCase();
    if (text.includes('empanada') || text.includes('pastel') || text.includes('reposter') || text.includes('croissant')) return 'croissant';
    if (text.includes('sandwich') || text.includes('emparedado') || text.includes('pan') || text.includes('tostada')) return 'sandwich';
    if (text.includes('fresco') || text.includes('jugo') || text.includes('te frio') || text.includes('té') || text.includes('gaseosa') || text.includes('bebida') || text.includes('refresco')) return 'cup-soda';
    if (text.includes('leche') || text.includes('batido')) return 'milk';
    if (text.includes('cafe') || text.includes('café') || text.includes('chocolate caliente')) return 'coffee';
    if (text.includes('fruta') || text.includes('manzana') || text.includes('sandia') || text.includes('sandía') || text.includes('pina') || text.includes('piña')) return 'apple';
    if (text.includes('ensalada') || text.includes('sopa') || text.includes('bowl') || text.includes('yogurt')) return 'bowl';
    if (text.includes('pinto') || text.includes('casado') || text.includes('almuerzo') || text.includes('arroz') || text.includes('plato')) return 'utensils';
    if (text.includes('pollo') || text.includes('carne') || text.includes('bistec') || text.includes('chuleta')) return 'meat';
    if (text.includes('pizza') || text.includes('taco') || text.includes('wrap')) return 'pizza';
    if (text.includes('galleta') || text.includes('snack') || text.includes('barra') || text.includes('cereal') || text.includes('avena')) return 'cookie';
    if (text.includes('gelatina') || text.includes('helado') || text.includes('postre') || text.includes('flan')) return 'ice-cream';

    return 'sandwich';
  }

  /**
   * Retorna el SVG puro del icono
   */
  function getFoodSvg(rawInput, fallbackName, size = 22) {
    const key = resolveIconKey(rawInput, fallbackName);
    const item = FOOD_ICONS[key] || FOOD_ICONS['sandwich'];
    return item.svg.replace('<svg ', `<svg width="${size}" height="${size}" `);
  }

  /**
   * Retorna una insignia circular elegante y limpia con el SVG dentro
   * variant: 'card' (catálogo POS/PWA 50x50), 'badge' (34x34 para carrito/filas), 'inline' (15x15 para texto)
   */
  function getFoodIconBadge(rawInput, fallbackName, variant = 'card') {
    const key = resolveIconKey(rawInput, fallbackName);

    if (variant === 'card') {
      const svg = getFoodSvg(key, null, 24);
      return `
        <div class="sibopay-food-badge-card" style="width: 50px; height: 50px; border-radius: 50%; background: #f0f9ff; border: 1.5px solid #bae6fd; color: #0284c7; display: flex; align-items: center; justify-content: center; margin: 0 auto 8px; box-shadow: 0 2px 6px rgba(2, 132, 199, 0.08); flex-shrink: 0; transition: all 0.2s ease;">
          ${svg}
        </div>
      `;
    }

    if (variant === 'badge') {
      const svg = getFoodSvg(key, null, 17);
      return `
        <div class="sibopay-food-badge-sm" style="width: 34px; height: 34px; border-radius: 9px; background: #f0f9ff; border: 1.2px solid #bae6fd; color: #0284c7; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; margin-right: 8px;">
          ${svg}
        </div>
      `;
    }

    if (variant === 'inline') {
      const svg = getFoodSvg(key, null, 15);
      return `<span style="display: inline-flex; align-items: center; justify-content: center; vertical-align: -2px; color: #0284c7; margin-right: 5px;">${svg}</span>`;
    }

    return getFoodSvg(key, fallbackName, 20);
  }

  /**
   * Renderiza el selector de iconos finos para los modales de creación/edición de productos
   */
  function renderIconPicker(containerId, inputId, previewId, currentKey) {
    const container = document.getElementById(containerId);
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    if (!container) return;

    const resolved = resolveIconKey(currentKey || (input ? input.value : 'sandwich'));
    if (input) input.value = resolved;
    if (preview) preview.innerHTML = getFoodIconBadge(resolved, null, 'card');

    const pickerKeys = [
      'sandwich', 'croissant', 'utensils', 'cup-soda',
      'milk', 'coffee', 'apple', 'bowl',
      'cookie', 'pizza', 'meat', 'ice-cream'
    ];

    container.innerHTML = pickerKeys.map(k => {
      const isAct = (k === resolved);
      const svg = getFoodSvg(k, null, 18);
      const label = FOOD_ICONS[k]?.label || k;
      return `
        <button type="button" 
                class="btn-food-icon-picker ${isAct ? 'active' : ''}" 
                id="btnFoodPick_${k}"
                onclick="window.SiboPayIcons.onPickIcon('${k}', '${containerId}', '${inputId}', '${previewId}')"
                title="${label}"
                style="width: 38px; height: 38px; border-radius: 8px; border: 1.5px solid ${isAct ? '#0284c7' : 'var(--border)'}; background: ${isAct ? '#f0f9ff' : 'var(--card-bg)'}; color: ${isAct ? '#0284c7' : 'var(--text-muted)'}; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s ease;">
          ${svg}
        </button>
      `;
    }).join('');
  }

  function onPickIcon(key, containerId, inputId, previewId) {
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    if (input) input.value = key;
    if (preview) preview.innerHTML = getFoodIconBadge(key, null, 'card');

    const container = document.getElementById(containerId);
    if (container) {
      container.querySelectorAll('.btn-food-icon-picker').forEach(b => {
        b.classList.remove('active');
        b.style.borderColor = 'var(--border)';
        b.style.background = 'var(--card-bg)';
        b.style.color = 'var(--text-muted)';
      });
      const activeBtn = document.getElementById(`btnFoodPick_${key}`);
      if (activeBtn) {
        activeBtn.classList.add('active');
        activeBtn.style.borderColor = '#0284c7';
        activeBtn.style.background = '#f0f9ff';
        activeBtn.style.color = '#0284c7';
      }
    }
  }

  // Exportar al ámbito global
  window.SiboPayIcons = {
    FOOD_ICONS,
    resolveIconKey,
    getFoodSvg,
    getFoodIconBadge,
    renderIconPicker,
    onPickIcon
  };

})(window);
