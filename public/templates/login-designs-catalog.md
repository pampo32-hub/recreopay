# Catálogo de Pantallas de Inicio de Sesión de SiboPay

Este documento actúa como la **memoria y registro de versiones** de pantallas de inicio de sesión de SiboPay. Cada diseño está preservado en código para que pueda ser reactivado cuando el administrador o el usuario lo solicite.

---

## 🎨 Opción 1: Clásico con Selector de Roles (Padre, Estudiante, Personal)
- **Archivo de Respaldo:** public/templates/login-classic-roles.html
- **Estilo:** Tarjeta flotante central sobre fondo neutro con efecto blur.
- **Características:**
  - Selector de pestaña superior: "Iniciar Sesión" y "Registro de Padres".
  - Selector visual interactivo "¿Quién eres?":
    - **Padre o Encargado** (ícono de familia)
    - **Estudiante Carné QR** (ícono de libreta/carné)
    - **Personal Soda / Caja** (ícono de local de comida/caja)
  - Formularios dinámicos que cambian placeholders y etiquetas según el rol seleccionado.
  - Accesos rápidos demo de 1-clic integrados en la tarjeta.
- **Cómo restaurarlo:**
  Reemplazar el contenido de <div id="viewLogin"> en public/index.html con el código almacenado en public/templates/login-classic-roles.html.

---

## 🚀 Opción 2: Minimalista Splash & Bottom Sheet (Estilo OrderEAT / SiboPay) [ACTUAL EN PRODUCCIÓN]
- **Archivo de Implementación:** public/index.html (dentro de #viewLogin)
- **Estilo:** Pantalla completa en degradado celeste oficial (#0284c7 a #0369a1) con marca de agua difuminada de siluetas de comida (ollas, brócoli, manzanas, cubiertos).
- **Características:**
  - Emblema central de SiboPay con aura translúcida y título blanco de alta legibilidad.
  - Eslogan institucional "Sistema Digital de Pagos y Monedero Estudiantil".
  - Botón principal tipo píldora blanca sólida: **"Iniciar Sesión"**.
  - Botón secundario translúcido con borde blanco: **"Registrarse"**.
  - Al pie absoluto de la pantalla: Enlace a **Términos y Condiciones** que abre un modal emergente rápido.
  - **Interacción fluida (Bottom Sheet):** Al presionar Iniciar Sesión o Registrarse, se despliega suavemente desde abajo una ventana moderna con los formularios, sin tapar abruptamente la identidad visual de la aplicación.
  - El sistema detecta el rol automáticamente al validar credenciales contra /api/auth/login.

---

## 💎 Opción 3: Glassmorphism Inmersivo (Diseño Frosted Glass & Specular Glow) [PLANTILLA ARCHIVADA]
- **Archivos de Plantilla Archivados:**
  - public/templates/design-glassmorphic-viewLogin.html
  - public/templates/design-glassmorphic-modalQr.html
  - public/templates/backup-styles-login-qr-original.css
- **Estilo:** Vidrio esmerilado translúcido (*frosted glass*) sobre fondo de gradiente profundo, reflejos especulares de 1px en los bordes, cápsulas flotantes y tipografía en blanco puro brillante (#ffffff).
- **Características:**
  1. **Tarjeta de Inicio de Sesión y Registro (#viewLogin & #loginBottomSheet):**
     - Ventana y tarjeta con efecto de cristal esmerilado (ackdrop-filter: blur(28px)).
     - Campos de texto (inputs) en cápsulas translúcidas con bordes de luz blanca.
     - Botones principales y de accesos rápidos con brillo y sombra de cristal.
  2. **Modal Inmersivo del Código QR de Pago (#modalQr):**
     - Tarjeta central de cristal esmerilado con biseles luminosos.
     - Marco de escaneo QR de alto contraste para lectura instantánea de cámara.
     - Botón de cierre en cápsula de vidrio flotante.
- **Cómo reactivarlo:**
  Reemplazar el contenido de #viewLogin o #modalQr con las plantillas en public/templates/design-glassmorphic-*.html.

---

*Última actualización de registro: 08 de Octubre de 2026*
