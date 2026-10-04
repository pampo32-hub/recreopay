# 🥪 RecreoPay - Soda Escolar Costa Rica 🇨🇷

> Sistema de Monedero Digital, Identificación por Código QR y Pre-Órdenes para Sodas Escolares en Costa Rica, adaptado pedagógicamente para estudiantes de 7 a 15 años y sus padres.

---

## 🎯 Propósito del Proyecto
RecreoPay resuelve el cuello de botella más crítico de los centros educativos costarricenses: **atender a cientos de estudiantes en los 15 a 20 minutos de recreo**.
Elimina el uso de dinero en efectivo en la escuela (evitando pérdidas, robos y compras indebidas), cumple con las directrices de **alimentación saludable del MEP**, y permite que los estudiantes de primaria sin teléfono móvil utilicen **carnés físicos plastificados con código QR**.

---

## 🚀 Características Principales

### 1. Experiencia de Usuario Adaptativa (UX/UI 7 a 15 Años)
* **🧒 Modo Kids (7 a 10 años / Primaria):**
  * Metáfora visual de "Monedas" y "Colones ₡".
  * Tarjetas táctiles gigantes con fotos de alta resolución e iconografía clara.
  * Interacciones con sonidos amigables de refuerzo positivo (Web Audio API).
  * Menor carga cognitiva y lectura simplificada.
* **⚡ Modo Teens (11 a 15 años / Secundaria):**
  * Estética moderna estilo fintech (Modo Oscuro / Cyber-slate).
  * Filtros ágiles de combos, platos del día y frescos naturales.
  * Indicadores nutricionales (calorías, sellos MEP saludable, alérgenos).

### 2. Doble Modalidad de Pago e Identificación
* **📱 QR Digital Dinámico (PWA):** En el teléfono móvil del estudiante con código QR de alto contraste.
* **🖨️ Carné Físico Impreso con QR:** Plantilla lista para imprimir en tamaño credencial estándar (85.6 × 54 mm) con foto del alumno, grado, sección, alérgenos y código QR.

### 3. Dos Flujos de Compra para Descongestionar el Recreo
1. **🛒 Venta en Mostrador (Monedero QR):** La cajera marca los productos, escanea el QR del estudiante en 0.5 segundos; el sistema verifica saldo, valida que no exceda el límite diario fijado por el padre y debita el saldo atómicamente.
2. **📦 Fila Rápida de Pre-Órdenes (Click & Collect):** El estudiante o padre pide desde su casa o aula para el 1er recreo o almuerzo. En el recreo, hay una fila rápida exclusiva donde solo escanean el QR y retiran la bolsa en 3 segundos.

### 4. Portal de Padres y Recargas SINPE Móvil
* Recargas directas con número de comprobante SINPE.
* Control del límite máximo de gasto diario (ej: máximo ₡2.500 por día).
* Filtro de alérgenos y opción de bloquear golosinas/chucherías.
* Auditoría completa de cada transacción y compra.

### 5. Terminal POS de la Soda con Escáner QR en Tiempo Real
* Soporta la cámara de tablets Android/iPad o lectores de código de barras láser USB.
* Notificaciones en tiempo real vía **Server-Sent Events (SSE)** cuando ingresa una nueva pre-orden.
* Alerta médica en pantalla si el estudiante identificado tiene alguna alergia registrada.

---

## 🛠️ Stack Tecnológico
* **Backend:** Node.js, Express, Better-SQLite3 (motor de base de datos con modo WAL y transacciones ACID).
* **Frontend:** PWA con HTML5 semántico, CSS Responsive adaptativo (Kids / Teens / POS), Vanilla JS modular y Web Audio API.
* **Códigos QR:** Generación de alta resolución vía biblioteca nativa `qrcode`.

---

## 💻 Instalación y Ejecución Local

1. **Clonar el repositorio:**
   ```bash
   git clone https://github.com/pampo32-hub/recreopay.git
   cd recreopay
   ```

2. **Instalar dependencias:**
   ```bash
   npm install
   ```

3. **Iniciar la aplicación:**
   ```bash
   npm start
   ```

4. **Abrir en el navegador:**
   * **📱 PWA Estudiantes / Padres:** [http://localhost:3030](http://localhost:3030)
   * **📟 Terminal de la Soda (Cajero y Escáner QR):** [http://localhost:3030/pos.html](http://localhost:3030/pos.html)
   * **🖨️ Generador de Carnés Físicos:** [http://localhost:3030/carnet.html](http://localhost:3030/carnet.html)

---

## 🌐 Repositorios Remotos
* **GitHub:** [https://github.com/pampo32-hub/recreopay](https://github.com/pampo32-hub/recreopay)
* **Gitea:** [https://git.reservascr.app/Pampo32/recreopay](https://git.reservascr.app/Pampo32/recreopay)
