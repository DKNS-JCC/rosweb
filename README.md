# WebApp con Login y SQLite

Una aplicación web básica con sistema de autenticación usando Node.js, Express, SQLite y tecnologías web estándar (HTML, CSS, JavaScript).

## Características

- ✅ Sistema de registro de usuarios
- ✅ Login con email o nombre de usuario
- ✅ Contraseñas hasheadas con bcrypt
- ✅ Sesiones de usuario
- ✅ Base de datos SQLite
- ✅ Dashboard protegido
- ✅ Diseño responsive
- ✅ Validación de formularios
- ✅ Logo corporativo integrado
- ✅ Favicon personalizado

## Requisitos

- Node.js 22 (ya instalado)
- npm (incluido con Node.js)

## Instalación

1. Instalar las dependencias:
```bash
npm install
```

2. Iniciar el servidor:
```bash
npm start
```

O para desarrollo con recarga automática:
```bash
npm run dev
```

3. Abrir el navegador en: http://localhost:3000

## Estructura del proyecto

```
rosweb/
├── package.json          # Dependencias y scripts
├── server.js             # Servidor Express principal
├── database.db           # Base de datos SQLite (se crea automáticamente)
├── icon.ico              # Logo de la aplicación
├── public/               # Archivos estáticos
│   ├── icon.ico          # Logo accesible desde el frontend
│   ├── login.html        # Página de login
│   ├── register.html     # Página de registro
│   ├── dashboard.html    # Dashboard (área protegida)
│   └── styles.css        # Estilos CSS
└── README.md             # Este archivo
```

## Uso

1. **Registro**: Ve a `/register` para crear una nueva cuenta
2. **Login**: Inicia sesión en `/login` usando tu nombre de usuario o email
3. **Dashboard**: Accede al área protegida después del login

## API Endpoints

- `POST /api/register` - Registrar nuevo usuario
- `POST /api/login` - Iniciar sesión
- `GET /api/user` - Obtener información del usuario actual
- `POST /api/logout` - Cerrar sesión

## Base de datos

La aplicación usa SQLite con una tabla `users`:

```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Seguridad

- Contraseñas hasheadas con bcrypt
- Sesiones con express-session
- Validación de entrada
- Protección de rutas

## Tecnologías utilizadas

- **Backend**: Node.js, Express.js
- **Base de datos**: SQLite
- **Autenticación**: bcrypt, express-session
- **Frontend**: HTML5, CSS3, JavaScript (vanilla)
- **Herramientas**: nodemon (desarrollo)

## Desarrollo

Para hacer cambios en el código:

1. Los archivos del servidor están en `server.js`
2. Los archivos del frontend están en la carpeta `public/`
3. Usa `npm run dev` para desarrollo con recarga automática
