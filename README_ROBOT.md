# 🤖 ROSWeb - Control de Robot TurtleBot

## Descripción

Esta aplicación web permite el control y gestión de un robot TurtleBot a través de ROS WebSocket. Combina un sistema de gestión de usuarios con funcionalidades avanzadas de robótica, incluyendo control remoto, monitoreo de sensores y gestión de tours robóticos.

## Características Principales

### 🎮 Control de Robot
- **Control remoto en tiempo real** del TurtleBot a través de WebSocket
- **Interfaz intuitiva** con controles direccionales
- **Control por teclado** (WASD y flechas direccionales)
- **Monitoreo de sensores** (LIDAR, odometría, cámara, IMU)
- **Estado de batería** y diagnósticos del robot
- **Log de actividades** en tiempo real

### 👥 Gestión de Usuarios
- Sistema de **autenticación** y registro
- **Roles de usuario** (admin/usuario)
- **Dashboard personalizado** para cada usuario
- **Historial de comandos** del robot por usuario

### 🎨 Tours Robóticos
- **Tours guiados** con el robot
- **Gestión de rutas** personalizadas
- **Múltiples idiomas** disponibles
- **Sistema de calificaciones** y feedback

### 📊 Panel Administrativo
- **Gestión completa de usuarios**
- **Monitoreo del robot** en tiempo real
- **Estadísticas del sistema**
- **Historial de comandos** del robot
- **Gestión de tours y rutas**

## Requisitos del Sistema

### Software Requerido
- **Node.js** (v14 o superior)
- **NPM** o **Yarn**
- **ROS** (Robot Operating System)
- **rosbridge_suite** para WebSocket

### Hardware
- **Robot TurtleBot** (TurtleBot3 recomendado)
- **Red WiFi** para comunicación
- **Sensores**: LIDAR, cámara, IMU (opcionales)

## Instalación

### 1. Clonar el repositorio
```bash
git clone <repository-url>
cd rosweb
```

### 2. Instalar dependencias
```bash
npm install
```

### 3. Configurar ROS Bridge
En el robot TurtleBot, ejecutar:
```bash
roslaunch rosbridge_server rosbridge_websocket.launch
```

### 4. Iniciar la aplicación
```bash
npm start
```

La aplicación estará disponible en: `http://localhost:3000`

## Configuración del Robot

### Tópicos ROS Utilizados

#### Publicación (Robot recibe comandos)
- `/cmd_vel` - Comandos de velocidad
- `/move_base/goal` - Objetivos de navegación
- `/initialpose` - Posición inicial

#### Suscripción (Robot envía datos)
- `/odom` - Odometría del robot
- `/scan` - Datos del LIDAR
- `/camera/image_raw` - Imagen de la cámara
- `/imu/data` - Datos del IMU
- `/battery_state` - Estado de la batería
- `/tf` - Transformaciones
- `/map` - Mapa del entorno

### URL de Conexión
```
ws://turtlebot-NUC.local:9090
```

## Uso de la Aplicación

### 1. Registro e Inicio de Sesión
1. Visita `http://localhost:3000`
2. Regístrate o inicia sesión
3. El usuario **admin/admin** tiene permisos administrativos

### 2. Control del Robot
1. Accede a **"🤖 Control Robot"** desde el menú principal
2. Verifica la **conexión ROS** (indicador verde)
3. Utiliza los **controles direccionales** o el teclado:
   - **W/↑**: Mover adelante
   - **S/↓**: Mover atrás
   - **A/←**: Girar izquierda
   - **D/→**: Girar derecha
   - **Espacio**: Parar

### 3. Monitoreo
- **Estado de conexión** en tiempo real
- **Posición del robot** (X, Y, Z, orientación)
- **Velocidades** lineales y angulares
- **Datos del LIDAR** (distancias, obstáculos)
- **Nivel de batería**

### 4. Panel Administrativo
- Acceso: `http://localhost:3000/admin`
- **Gestión de usuarios** y permisos
- **Estadísticas del sistema**
- **Historial de comandos** del robot
- **Gestión de tours**

## API Endpoints

### Autenticación
- `POST /api/login` - Iniciar sesión
- `POST /api/register` - Registrar usuario
- `POST /api/logout` - Cerrar sesión
- `GET /api/user` - Información del usuario actual

### Robot
- `GET /api/robot/status` - Estado del robot y conexión ROS
- `POST /api/robot/command` - Enviar comandos al robot
- `GET /api/robot/info` - Información detallada del robot

### Administración
- `GET /api/admin/users` - Lista de usuarios
- `GET /api/admin/stats` - Estadísticas del sistema
- `GET /api/admin/robot/commands` - Historial de comandos
- `POST /api/admin/routes` - Crear rutas de tours

## Comandos del Robot

### Comandos Básicos
```javascript
// Mover adelante
POST /api/robot/command
{
  "action": "move_forward",
  "parameters": { "speed": 0.2 }
}

// Girar izquierda
POST /api/robot/command
{
  "action": "turn_left", 
  "parameters": { "speed": 0.5 }
}

// Parar
POST /api/robot/command
{
  "action": "stop"
}

// Velocidad personalizada
POST /api/robot/command
{
  "action": "custom_velocity",
  "parameters": { 
    "linear": 0.1, 
    "angular": 0.3 
  }
}
```

## Estructura del Proyecto

```
rosweb/
├── public/
│   ├── index.html          # Página principal
│   ├── robot.html          # Control del robot
│   ├── admin.html          # Panel administrativo
│   ├── login.html          # Página de login
│   ├── register.html       # Página de registro
│   ├── dashboard.html      # Dashboard del usuario
│   └── styles.css          # Estilos CSS
├── server.js               # Servidor Express principal
├── robotManager.js         # Gestión del robot y ROS
├── database.db             # Base de datos SQLite
└── package.json            # Dependencias del proyecto
```

## Seguridad

- **Autenticación** requerida para todas las operaciones del robot
- **Roles de usuario** para control de acceso
- **Sesiones seguras** con Express Session
- **Passwords hasheadas** con bcrypt
- **Logs de actividad** para auditoría

## Características Avanzadas

### 1. Reconexión Automática
- Reconexión automática al ROS Bridge cada 30 segundos
- Manejo de errores de conexión
- Estado de conexión en tiempo real

### 2. Control Multiusuario
- Múltiples usuarios pueden monitorear simultáneamente
- Control exclusivo (un usuario a la vez)
- Historial de comandos por usuario

### 3. Integración con Tours
- Tours automatizados con el robot
- Rutas predefinidas
- Sistema de feedback y calificaciones

## Troubleshooting

### Problemas de Conexión ROS
1. Verificar que `rosbridge_server` esté ejecutándose
2. Comprobar la URL de conexión
3. Verificar conectividad de red
4. Revisar firewall y puertos

### Problemas de Control
1. Verificar permisos del usuario
2. Comprobar estado de la batería del robot
3. Verificar que el robot no tenga errores
4. Reiniciar la conexión ROS

### Performance
- Limitar la frecuencia de comandos
- Optimizar la frecuencia de actualización de sensores
- Monitorear el uso de ancho de banda

## Contribuir

1. Fork del repositorio
2. Crear una rama para features: `git checkout -b feature/nueva-caracteristica`
3. Commit de cambios: `git commit -am 'Agregar nueva característica'`
4. Push a la rama: `git push origin feature/nueva-caracteristica`
5. Crear un Pull Request

## Licencia

Este proyecto está bajo la Licencia MIT. Ver `LICENSE` para más detalles.

## Soporte

Para soporte técnico o reportar bugs:
- Crear un issue en GitHub
- Contactar al equipo de desarrollo
- Consultar la documentación de ROS

---

**¡Disfruta controlando tu robot TurtleBot! 🤖🎮**
