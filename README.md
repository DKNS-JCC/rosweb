# 🤖 Sistema de Control Web TurtleBot - ArtTEC

Un sistema completo de control web para robot TurtleBot con integración ROS, monitoreo en tiempo real, gestión multiusuario y panel administrativo avanzado.

## 🌟 Características Principales

### 🤖 **Control de Robot**
- ✅ **Control web completo** del TurtleBot vía WebSocket
- ✅ **Movimiento direccional** con botones y teclado (WASD/Flechas)
- ✅ **Parada de emergencia** múltiple (botón STOP, tecla Espacio)
- ✅ **Velocidades configurables** (linear: 0.2 m/s, angular: 0.5 rad/s)
- ✅ **Conexión ROS Bridge** a `ws://turtlebot-NUC.local:9090`
- ✅ **Control en tiempo real** con feedback visual inmediato
- ✅ **Interfaz táctil** optimizada para dispositivos móviles
- ✅ **Modo administrador** con controles avanzados

### 📡 **Sensores en Tiempo Real**
- ✅ **Odometría** - Posición X, Y, Z y orientación en grados
- ✅ **LIDAR** - Sensor láser 360° con detección de obstáculos
- ✅ **Batería Kobuki** - Nivel, voltaje, estado de carga y alertas
- ✅ **Cámara** - Stream de video 640x480 en tiempo real
- ✅ **Diagnósticos** - Estado completo del sistema TurtleBot
- ✅ **Monitoreo continuo** de conectividad y tópicos ROS
- ✅ **Alertas automáticas** por email de batería baja

### 👥 **Sistema Multiusuario Avanzado**
- ✅ **Autenticación completa** con email/username + password
- ✅ **Roles diferenciados** (Usuario/Administrador/Técnico)
- ✅ **Sesiones seguras** con express-session y expiración
- ✅ **Contraseñas hasheadas** con bcrypt
- ✅ **Control de acceso** basado en roles y permisos
- ✅ **Perfiles de usuario** con fotos personalizables
- ✅ **Gestión de usuarios** completa para administradores
- ✅ **Historial de actividad** por usuario

### 🗺️ **Sistema de Tours Inteligente**
- ✅ **Gestión completa de tours** con rutas predefinidas
- ✅ **Waypoints interactivos** con descripciones detalladas
- ✅ **Asignación automática de robots** a tours
- ✅ **Seguimiento de progreso** en tiempo real
- ✅ **Historial de tours** con calificaciones y feedback
- ✅ **IA generativa** con Gemini para descripciones automáticas
- ✅ **Soporte multiidioma** para tours
- ✅ **Sistema de pines** para acceso seguro a tours

### 📧 **Sistema de Notificaciones Avanzado**
- ✅ **Notificaciones por email** configurables
- ✅ **Throttling inteligente** para evitar spam
- ✅ **Horarios de trabajo** configurables
- ✅ **Múltiples tipos** de notificaciones (batería, errores, desconexiones)
- ✅ **Prioridades** (crítico, alto, medio, bajo)
- ✅ **Plantillas HTML** para emails atractivos
- ✅ **Configuración centralizada** en notificationConfig.js

### 🔧 **Panel Administrativo Completo**
- ✅ **Gestión de usuarios** completa (CRUD)
- ✅ **Estadísticas del sistema** en tiempo real
- ✅ **Historial de comandos** del robot con timestamps
- ✅ **Monitoreo de actividad** de usuarios y robots
- ✅ **Estado del robot** centralizado y detallado
- ✅ **Gestión de tours** y rutas
- ✅ **Configuración del sistema** avanzada
- ✅ **Logs del sistema** con niveles de error

### 📊 **Dashboard y Estadísticas**
- ✅ **Dashboard principal** con métricas clave
- ✅ **Estadísticas en tiempo real** de tópicos activos
- ✅ **Monitoreo de batería** con gráficos históricos
- ✅ **Posición del robot** en mapa 2D
- ✅ **Contadores de obstáculos** detectados por LIDAR
- ✅ **Usuarios conectados** y sesiones activas
- ✅ **Historial completo** de comandos enviados
- ✅ **Gráficos interactivos** con Three.js

### 🛡️ **Seguridad y Robustez**
- ✅ **Manejo completo de errores** con try-catch
- ✅ **Reconexión automática** ROS cada 30 segundos
- ✅ **Monitoreo de tópicos** con timeouts configurables
- ✅ **Logging optimizado** para evitar spam
- ✅ **Validación de datos** de sensores
- ✅ **Protección CSRF** con Helmet
- ✅ **Límite de tamaño** de archivos subidos (5MB)
- ✅ **Validación de tipos** de archivos para imágenes

### 📱 **Interfaz Web Moderna**
- ✅ **Diseño responsive** para móviles y tablets
- ✅ **Interfaz intuitiva** con navegación clara
- ✅ **Tema moderno** con gradientes y sombras
- ✅ **Animaciones suaves** y transiciones
- ✅ **Compatibilidad** con navegadores modernos
- ✅ **Accesibilidad** mejorada con ARIA labels
- ✅ **Modo oscuro** opcional
- ✅ **Iconografía** consistente y moderna

### ⚡ **Optimización y Rendimiento**
- ✅ **Throttling automático** de mensajes de cámara
- ✅ **Logging probabilístico** para reducir spam
- ✅ **Actualización eficiente** de la interfaz
- ✅ **Gestión inteligente** de recursos del navegador
- ✅ **Compresión** de respuestas HTTP
- ✅ **Cache** de descripciones generadas por IA
- ✅ **Conexiones WebSocket** optimizadas
- ✅ **Lazy loading** de componentes pesados

## 🚀 Características Avanzadas

### **🔄 Reconexión Automática y Monitoreo**
- Reintento de conexión ROS cada 30 segundos
- Notificación visual del estado de conectividad
- Restablecimiento automático de suscripciones
- Monitoreo continuo de tópicos activos
- Alertas por email de desconexiones críticas

### **🧠 Inteligencia Artificial Integrada**
- **Gemini AI** para generar descripciones detalladas de waypoints
- Descripciones automáticas en múltiples idiomas
- Cache inteligente para evitar regeneración innecesaria
- Optimización de prompts para voz y texto

### **📧 Sistema de Notificaciones Inteligente**
- Notificaciones por email con throttling configurable
- Múltiples tipos: batería, errores, desconexiones, tours
- Prioridades: crítico, alto, medio, bajo
- Horarios de trabajo configurables
- Plantillas HTML responsivas

### **👥 Gestión Avanzada de Usuarios**
- Tres roles diferenciados: Usuario, Técnico, Administrador
- Sistema de perfiles con fotos personalizables
- Control de acceso granular por funcionalidades
- Historial completo de actividad por usuario
- Gestión de sesiones con expiración automática

### **🎯 Sistema de Tours Robótico**
- Rutas predefinidas con waypoints geolocalizados
- Asignación automática de robots disponibles
- Seguimiento GPS del progreso en tiempo real
- Sistema de pines para acceso seguro
- Calificaciones y feedback de usuarios
- Historial detallado de tours completados

### **📊 Dashboard y Analytics**
- Métricas en tiempo real de todos los sensores
- Gráficos históricos de batería y uso
- Contadores de obstáculos y detecciones LIDAR
- Estadísticas de usuarios conectados
- Reportes de rendimiento del sistema

### **🛡️ Seguridad Multicapa**
- Autenticación obligatoria para todas las funciones
- Hash seguro de contraseñas con bcrypt
- Protección CSRF con Helmet
- Validación de tipos y tamaños de archivos
- Logging completo de todas las acciones
- Controles de acceso basados en roles

### **📱 Experiencia Móvil Optimizada**
- Diseño completamente responsive
- Controles táctiles optimizados para tablets
- Navegación móvil intuitiva
- Compatibilidad con gestos multitáctiles
- Optimización de batería en dispositivos móviles

### **⚡ Optimización de Rendimiento**
- Throttling automático de streams de video
- Logging probabilístico para reducir spam
- Compresión de respuestas HTTP
- Cache de descripciones generadas por IA
- Lazy loading de componentes pesados
- Gestión inteligente de conexiones WebSocket

## 🚀 Requisitos

### **Sistema Operativo**
- Linux (Ubuntu/ROS compatible)
- Node.js 22.x (ya instalado)
- npm (incluido con Node.js)

### **Robot TurtleBot**
- TurtleBot con Kobuki base
- ROS Bridge Server ejecutándose
- Sensores: LIDAR, cámara, odometría
- Conectividad: `ws://turtlebot-NUC.local:9090`

## ⚙️ Instalación

### 1. **Clonar el repositorio**
```bash
git clone https://github.com/DKNS-JCC/rosweb.git
cd rosweb
```

### 2. **Instalar dependencias**
```bash
npm install
```

### 3. **Iniciar el servidor**
```bash
npm start
```

### 4. **Para desarrollo con recarga automática**
```bash
npm run dev
```

### 5. **Acceder a la aplicación**
- **Aplicación principal**: http://localhost:3000
- **Control del robot**: http://localhost:3000/robot
- **Panel administrativo**: http://localhost:3000/admin

## 📊 Estructura del Proyecto

```
rosweb/
├── 📦 package.json                    # Dependencias y configuración npm
├── 🚀 server.js                      # Servidor Express principal + API
├── 🗄️ database.db                    # Base de datos SQLite
├── 🖼️ icon.ico                       # Logo de la aplicación
├── 🤖 robotManager.js                # Gestor de conexión ROS y sensores
├── 📧 emailNotifier.js               # Sistema de notificaciones por email
├── ⚙️ notificationConfig.js          # Configuración de notificaciones
├── 📁 public/                        # Archivos estáticos del frontend
│   ├── 🏠 index.html                 # Página principal con dashboard
│   ├── 🔐 login.html                 # Sistema de autenticación
│   ├── 📝 register.html              # Registro de nuevos usuarios
│   ├── 📊 dashboard.html             # Dashboard personal del usuario
│   ├── 🔧 admin.html                 # Panel administrativo completo
│   ├── 🤖 robot.html                 # Control avanzado del robot
│   ├── 🎯 tours.html                 # Selección y gestión de tours
│   ├── 📈 stats.html                 # Estadísticas detalladas del sistema
│   ├── 🎨 styles.css                 # Estilos CSS globales
│   ├── 🧭 navigation.js              # Utilidades de navegación
│   └── 🖼️ icon.ico                   # Logo accesible desde frontend
├── 📁 uploads/                       # Imágenes de perfil de usuarios
│   ├── profile_1_*.jpg               # Fotos de perfil de usuarios
│   └── profile_3_*.jpeg
├── 📋 RESUMEN_SISTEMA.md             # Documentación técnica completa
├── 🔧 SOLUCION_COMPLETA.md           # Guía de resolución de problemas
├── 🔋 ACTUALIZACION_BATERIA.md       # Sistema de batería Kobuki
└── 📖 README.md                      # Esta documentación
```

## 🎮 Uso del Sistema

### **1. Cuentas de Usuario por Defecto**
```bash
# Administrador (acceso completo)
Usuario: admin
Contraseña: admin123

# Técnico (mantenimiento y configuración)
Usuario: tecnico
Contraseña: tecnico123
```

### **2. Registro e Inicio de Sesión**
```bash
# Crear cuenta nueva
http://localhost:3000/register

# Iniciar sesión
http://localhost:3000/login
```

### **3. Control del Robot**
```bash
# Acceso directo al control
http://localhost:3000/robot
```

**Controles disponibles:**
- **🎮 Botones**: Interfaz táctil con botones direccionales
- **⌨️ Teclado**: 
  - `W/↑` - Adelante
  - `S/↓` - Atrás  
  - `A/←` - Girar izquierda
  - `D/→` - Girar derecha
  - `Espacio` - Parada de emergencia

### **4. Sistema de Tours**
```bash
# Seleccionar tour disponible
http://localhost:3000/tours

# Iniciar tour con PIN de seguridad
# El sistema asigna automáticamente un robot disponible
```

**Características de Tours:**
- **Rutas predefinidas** con waypoints específicos
- **Descripciones generadas por IA** para cada punto
- **Seguimiento GPS** del progreso
- **Calificaciones y feedback** al completar
- **Historial completo** de tours realizados

### **5. Panel Administrativo**
```bash
# Solo para administradores
http://localhost:3000/admin
```

**Funcionalidades administrativas:**
- Gestión completa de usuarios (crear, editar, eliminar)
- Configuración de tours y rutas
- Monitoreo en tiempo real del sistema
- Estadísticas detalladas y reportes
- Configuración de notificaciones
- Gestión de robots y asignaciones

### **6. Dashboard Personal**
```bash
# Dashboard del usuario
http://localhost:3000/dashboard
```

**Funcionalidades del usuario:**
- Vista general del estado del sistema
- Historial personal de tours
- Control rápido del robot
- Perfil personal con foto
- Estadísticas de uso

### **Variables de Entorno**
```bash
# Servidor
PORT=3000                              # Puerto del servidor web
NODE_ENV=production                    # Entorno (development/production)

# Base de datos
DATABASE_PATH=./database.db            # Ruta de la base de datos SQLite

# ROS Bridge
ROS_BRIDGE_URL=ws://turtlebot-NUC.local:9090  # URL del ROS Bridge
ROS_RECONNECT_INTERVAL=30000           # Intervalo de reconexión (ms)

# IA Generativa (Gemini)
GEMINI_API_KEY=your_api_key_here       # API Key de Google Gemini

# Email (Notificaciones)
EMAIL_USER=artecrobotics25@gmail.com   # Usuario de email
EMAIL_PASS=hfbn zftl ycvg fain         # Contraseña de aplicación
EMAIL_DESTINATION=artecrobotics25@gmail.com  # Destino de notificaciones

# Seguridad
SESSION_SECRET=mi-secreto-super-seguro # Secreto para sesiones
BCRYPT_ROUNDS=10                       # Rondas de hash para contraseñas

# Configuración de archivos
MAX_FILE_SIZE=5242880                  # Tamaño máximo de archivos (5MB)
UPLOAD_PATH=./uploads                  # Directorio de archivos subidos

# Configuración de notificaciones
NOTIFICATION_THROTTLE=60               # Throttle en minutos
WORKING_HOURS_ONLY=false               # Solo notificaciones en horario laboral
WORKING_HOURS_START=09:00              # Hora de inicio
WORKING_HOURS_END=18:00                # Hora de fin
```

## 📞 Soporte

### **Documentación Adicional**
- `RESUMEN_SISTEMA.md` - Funcionalidades completas del sistema
- `SOLUCION_COMPLETA.md` - Resolución de problemas técnicos
- `ACTUALIZACION_BATERIA.md` - Sistema de batería Kobuki
- `README.md` - Esta documentación general

### **Información Técnica**
- **Framework**: Node.js + Express.js
- **Base de datos**: SQLite con migraciones automáticas
- **Frontend**: HTML5 + CSS3 + JavaScript vanilla
- **ROS**: ROSLib.js + WebSocket Bridge
- **IA**: Google Gemini 2.5 Flash
- **Autenticación**: bcrypt + express-session
- **Notificaciones**: Nodemailer con plantillas HTML
- **WebSockets**: Express-WS + Socket.IO

### **Arquitectura del Sistema**
- **Backend**: Node.js con Express.js
- **Base de datos**: SQLite con esquemas relacionales
- **Comunicación**: WebSocket + HTTP REST API
- **Autenticación**: Sesiones con roles y permisos
- **Monitoreo**: Sistema de logs y notificaciones
- **IA**: Integración con Gemini para contenido dinámico

### **Configuración Recomendada**
- **CPU**: 2 núcleos mínimo, 4 recomendado
- **RAM**: 4GB mínimo, 8GB recomendado
- **Almacenamiento**: 10GB para datos y logs
- **Red**: Conexión estable al ROS Bridge
- **Navegador**: Chrome/Edge/Firefox actualizados

### **Soporte y Contacto**
- **Email**: artecrobotics25@gmail.com
- **Repositorio**: https://github.com/DKNS-JCC/rosweb
- **Issues**: Para reportar bugs o solicitar features
- **Documentación**: Archivos MD en el repositorio

---
**Desarrollado por ArtTEC** 🤖✨
