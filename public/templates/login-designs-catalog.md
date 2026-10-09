# CatÃ¡logo de Pantallas de Inicio de SesiÃ³n de SiboPay

Este documento actÃºa como la **memoria y registro de versiones** de pantallas de inicio de sesiÃ³n de SiboPay. Cada diseÃ±o estÃ¡ preservado en cÃ³digo para que pueda ser reactivado cuando el administrador o el usuario lo solicite.

---

## ðŸŽ¨ OpciÃ³n 1: ClÃ¡sico con Selector de Roles (Padre, Estudiante, Personal)
- **Archivo de Respaldo:** `public/templates/login-classic-roles.html`
- **Estilo:** Tarjeta flotante central sobre fondo neutro con efecto blur.
- **CaracterÃ­sticas:**
  - Selector de pestaÃ±a superior: "Iniciar SesiÃ³n" y "Registro de Padres".
  - Selector visual interactivo "Â¿QuiÃ©n eres?":
    - **Padre o Encargado** (Ã­cono de familia)
    - **Estudiante CarnÃ© QR** (Ã­cono de libreta/carnÃ©)
    - **Personal Soda / Caja** (Ã­cono de local de comida/caja)
  - Formularios dinÃ¡micos que cambian placeholders y etiquetas segÃºn el rol seleccionado.
  - Accesos rÃ¡pidos demo de 1-clic integrados en la tarjeta.
- **CÃ³mo restaurarlo:**
  Reemplazar el contenido de `<div id="viewLogin">` en `public/index.html` con el cÃ³digo almacenado en `public/templates/login-classic-roles.html`.

---

## ðŸš€ OpciÃ³n 2: Minimalista Splash & Bottom Sheet (Estilo OrderEAT / SiboPay)
- **Archivo de ImplementaciÃ³n:** `public/index.html` (dentro de `#viewLogin`)
- **Estilo:** Pantalla completa en degradado celeste oficial (`#0284c7` a `#0369a1`) con marca de agua difuminada de siluetas de comida (ollas, brÃ³coli, manzanas, cubiertos).
- **CaracterÃ­sticas:**
  - Emblema central de SiboPay con aura translÃºcida y tÃ­tulo blanco de alta legibilidad.
  - Eslogan institucional "Sistema Digital de Pagos y Monedero Estudiantil".
  - BotÃ³n principal tipo pÃ­ldora blanca sÃ³lida: **"Iniciar SesiÃ³n"**.
  - BotÃ³n secundario translÃºcido con borde blanco: **"Registrarse"**.
  - Al pie absoluto de la pantalla: Enlace a **TÃ©rminos y Condiciones** que abre un modal emergente rÃ¡pido.
  - **InteracciÃ³n fluida (Bottom Sheet):** Al presionar Iniciar SesiÃ³n o Registrarse, se despliega suavemente desde abajo una ventana moderna con los formularios, sin tapar abruptamente la identidad visual de la aplicaciÃ³n.
  - El sistema detecta el rol automÃ¡ticamente al validar credenciales contra `/api/auth/login`.

---

*Fecha de registro: 07 de Octubre de 2026*


---

## 💎 Opción 3: Glassmorphism Inmersivo (Diseño Frosted Glass & Specular Glow)
- **Archivos de Respaldo para Reversión Inmediata:**
  - public/templates/backup-viewLogin-original.html
  - public/templates/backup-modalQr-original.html
  - public/templates/backup-styles-login-qr-original.css
- **Estilo:** Vidrio esmerilado translúcido (*frosted glass*) sobre fondo de gradiente profundo, reflejos especulares de 1px en los bordes, cápsulas flotantes y tipografía en blanco puro brillante (#ffffff).
- **Elementos transformados:**
  1. **Tarjeta de Inicio de Sesión y Registro (#viewLogin & #loginBottomSheet):**
     - Ventana y tarjeta con efecto de cristal esmerilado (ackdrop-filter: blur(28px)).
     - Campos de texto (inputs) en cápsulas translúcidas con bordes de luz blanca.
     - Botones principales y de accesos rápidos con brillo y sombra de cristal.
  2. **Modal Inmersivo del Código QR de Pago (#modalQr):**
     - Tarjeta central de cristal esmerilado con biseles luminosos.
     - Marco de escaneo QR de alto contraste para lectura instantánea de cámara.
     - Botón de cierre en cápsula de vidrio flotante.
- **Instrucción de Rollback:**
  Para revertir inmediatamente al diseño anterior si no te gusta, simplemente restaura los bloques HTML desde public/templates/backup-viewLogin-original.html y public/templates/backup-modalQr-original.html o reactiva las reglas de estilo de respaldo.

