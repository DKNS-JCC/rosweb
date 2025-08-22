# Sistema de Notificaciones por Email - artTEC

## 📧 Descripción

El sistema de notificaciones por email envía alertas automáticas sobre eventos importantes en el sistema artTEC a la cuenta `artecrobotics25@gmail.com`.

## ⚙️ Configuración

### Credenciales de Email
- **Cuenta**: artecrobotics25@gmail.com
- **Contraseña de App**: hfbn zftl ycvg fain

### Archivos Principales
- `emailNotifier.js` - Módulo principal de notificaciones
- `notificationConfig.js` - Configuración personalizable
- `public/notifications.html` - Panel de administración web

## 🚨 Tipos de Notificaciones

### Críticas (Envío inmediato)
- **BATTERY_CRITICAL** - Batería del robot < 10%
- **SYSTEM_ERROR** - Errores críticos del sistema

### Alta Prioridad
- **BATTERY_LOW** - Batería del robot < 20%
- **ROBOT_ERROR** - Errores del robot
- **ROBOT_DISCONNECTED** - Robot perdió conexión

### Prioridad Media
- **USER_DELETED** - Usuario eliminado del sistema
- **TOUR_ABANDONED** - Tour abandonado por usuario
- **ROBOT_RECONNECTED** - Robot reconectado
- **ROUTE_DELETED** - Ruta eliminada

### Prioridad Baja
- **USER_CREATED** - Nuevo usuario registrado
- **TOUR_STARTED** - Nuevo tour iniciado
- **TOUR_COMPLETED** - Tour completado exitosamente
- **ROUTE_CREATED** - Nueva ruta creada

## 🔧 Configuración Personalizada

### Editar `notificationConfig.js`:

```javascript
module.exports = {
    general: {
        enabled: true,  // Habilitar/deshabilitar sistema
        throttleTime: 1 // Tiempo mínimo entre notificaciones (min)
    },
    
    notifications: {
        BATTERY_LOW: {
            enabled: true,
            priority: 'high'
        }
        // ... más configuraciones
    },
    
    throttling: {
        BATTERY_LOW: 30,  // Máximo una vez cada 30 min
        ROBOT_ERROR: 10   // Máximo una vez cada 10 min
        // ... más configuraciones
    }
};
```

## 🎛️ Panel de Administración

Accede a `/notifications` (requiere permisos de admin) para:

- ✅ Ver estado del sistema de notificaciones
- ⚙️ Habilitar/deshabilitar notificaciones
- 🧪 Enviar notificaciones de prueba
- 📋 Ver log de actividad en tiempo real

## 📡 API Endpoints

### Estado del Sistema
```bash
GET /api/admin/notification-status
```

### Habilitar/Deshabilitar
```bash
POST /api/admin/notifications/toggle
Body: { "enabled": true/false }
```

### Enviar Notificación de Prueba
```bash
POST /api/admin/test-notification
Body: { "type": "BATTERY_LOW" }
```

### Notificar Tour Abandonado
```bash
POST /api/tour/abandon
Body: { "tour_id": "abc123", "progress": 50 }
```

## 🔄 Integración Automática

El sistema se integra automáticamente en:

### Gestión de Usuarios
- ✅ Registro de nuevos usuarios
- ❌ Eliminación de usuarios

### Tours
- ▶️ Inicio de tours
- ✅ Finalización de tours
- ⏹️ Abandono de tours

### Robot TurtleBot
- 🔋 Monitoreo de batería automático
- 📡 Estado de conexión
- ❌ Errores de navegación

### Gestión de Rutas
- 🗺️ Creación de rutas
- 🗑️ Eliminación de rutas

## 🚀 Instalación y Uso

### Dependencias
Las dependencias ya están instaladas en `package.json`:
- `nodemailer` - Para envío de emails

### Inicialización Automática
El sistema se inicializa automáticamente cuando se inicia el servidor:

```bash
npm start
```

### Verificar Funcionamiento
1. Accede a `/notifications` como admin
2. Verifica que el estado sea "Conectado"
3. Envía una notificación de prueba
4. Revisa el inbox de artecrobotics25@gmail.com

## 🛡️ Seguridad

### Throttling
- Evita spam limitando frecuencia de notificaciones
- Configuración personalizable por tipo de evento

### Autenticación
- Solo administradores pueden gestionar notificaciones
- API endpoints protegidos con `requireAdmin`

### Logging
- Todas las notificaciones se registran en consola
- Panel web muestra actividad en tiempo real

## ❌ Solución de Problemas

### Email no se envía
1. Verificar credenciales en `emailNotifier.js`
2. Comprobar que la clave de app sea correcta
3. Revisar configuración de Gmail (2FA habilitado)

### Robot no reporta batería
- El sistema incluye simulación para pruebas
- Verificar conexión ROS Bridge
- Revisar tópicos disponibles en `/mobile_base/sensors/core`

### Notificaciones muy frecuentes
- Ajustar valores de throttling en `notificationConfig.js`
- Deshabilitar tipos específicos si es necesario

## 🔮 Funciones Futuras

- 📱 Notificaciones push a dispositivos móviles
- 📊 Dashboard con métricas de notificaciones
- 🕐 Programación de notificaciones
- 📧 Múltiples destinatarios de email
- 🔗 Integración con Slack/Teams
- 📈 Alertas basadas en tendencias

## 📞 Contacto

Para soporte o mejoras del sistema de notificaciones, contacta al equipo de desarrollo de artTEC.

---
*Sistema desarrollado para artTEC - Robot Tour Guide Platform*
