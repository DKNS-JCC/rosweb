const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const robotManager = require('./robotManager');

const app = express();
const PORT = 3000;

// Configuración de middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuración de sesiones
app.use(session({
    secret: 'mi-secreto-super-seguro',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 horas
}));

// Inicializar base de datos SQLite
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error('Error al conectar con la base de datos:', err.message);
    } else {
        console.log('Conectado a la base de datos SQLite');
    }
});

// Crear tabla de usuarios si no existe
db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// Añadir columna role a usuarios existentes (si no existe)
db.run(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error al añadir columna role:', err.message);
    }
});

// Crear usuario admin por defecto si no existe
db.get('SELECT * FROM users WHERE role = ?', ['admin'], async (err, admin) => {
    if (err) {
        console.error('Error al verificar admin:', err);
        return;
    }
    
    if (!admin) {
        try {
            const bcrypt = require('bcrypt');
            const adminPassword = await bcrypt.hash('admin123', 10);
            db.run('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)', 
                ['admin', 'admin@arttec.com', adminPassword, 'admin'], 
                function(err) {
                    if (err) {
                        console.error('Error al crear admin:', err);
                    } else {
                        console.log('✅ Usuario admin creado - User: admin, Pass: admin123');
                    }
                }
            );
        } catch (error) {
            console.error('Error al crear contraseña admin:', error);
        }
    }
});

// Crear tabla de rutas de tours
db.run(`CREATE TABLE IF NOT EXISTS tour_routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    duration INTEGER NOT NULL,
    languages TEXT,
    icon TEXT,
    price DECIMAL(10,2),
    is_active BOOLEAN DEFAULT 1,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users (id)
)`);

// Crear tabla de historial de tours realizados
db.run(`CREATE TABLE IF NOT EXISTS tour_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    tour_route_id INTEGER,
    tour_type TEXT NOT NULL,
    tour_name TEXT NOT NULL,
    tour_id TEXT NOT NULL,
    pin TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed BOOLEAN DEFAULT 0,
    rating INTEGER,
    feedback TEXT,
    FOREIGN KEY (user_id) REFERENCES users (id),
    FOREIGN KEY (tour_route_id) REFERENCES tour_routes (id)
)`);

// Middleware para verificar autenticación
function requireAuth(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        // Si es una petición de API, devolver JSON
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'No autorizado' });
        }
        // Si es una página, redirigir
        res.redirect('/login');
    }
}

// Middleware para verificar permisos de administrador
function requireAdmin(req, res, next) {
    if (!req.session.userId) {
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'No autorizado' });
        }
        return res.redirect('/login');
    }
    
    // Verificar que el usuario sea admin
    db.get('SELECT role FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Error en la base de datos' });
        }
        
        if (!user || user.role !== 'admin') {
            if (req.path.startsWith('/api/')) {
                return res.status(403).json({ error: 'Acceso denegado - Se requieren permisos de administrador' });
            }
            return res.status(403).send('Acceso denegado - Se requieren permisos de administrador');
        }
        
        next();
    });
}

// Rutas

// Página principal (índice)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Página de login
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Página de registro
app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// ========== RUTAS ADMINISTRATIVAS (OCULTAS) ==========

// Panel de administración (ruta oculta)
app.get('/admin', requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// API para obtener todas las rutas (solo admin)
app.get('/api/admin/routes', requireAdmin, (req, res) => {
    db.all('SELECT * FROM tour_routes ORDER BY created_at DESC', (err, routes) => {
        if (err) {
            return res.status(500).json({ error: 'Error al obtener rutas' });
        }
        res.json(routes);
    });
});

// API para crear nueva ruta (solo admin)
app.post('/api/admin/routes', requireAdmin, (req, res) => {
    const { name, description, duration, languages, icon, price } = req.body;
    
    if (!name || !duration) {
        return res.status(400).json({ error: 'Nombre y duración son requeridos' });
    }
    
    db.run(
        'INSERT INTO tour_routes (name, description, duration, languages, icon, price, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [name, description, duration, languages, icon, price, req.session.userId],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Error al crear ruta' });
            }
            res.json({ success: true, routeId: this.lastID });
        }
    );
});

// API para eliminar ruta (solo admin)
app.delete('/api/admin/routes/:id', requireAdmin, (req, res) => {
    const routeId = req.params.id;
    
    db.run('DELETE FROM tour_routes WHERE id = ?', [routeId], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Error al eliminar ruta' });
        }
        res.json({ success: true });
    });
});

// API para obtener estadísticas del admin
app.get('/api/admin/stats', requireAdmin, (req, res) => {
    const stats = {};
    
    // Contar usuarios
    db.get('SELECT COUNT(*) as count FROM users', (err, userCount) => {
        if (err) {
            return res.status(500).json({ error: 'Error al obtener estadísticas' });
        }
        
        stats.totalUsers = userCount.count;
        
        // Contar rutas
        db.get('SELECT COUNT(*) as count FROM tour_routes', (err, routeCount) => {
            if (err) {
                return res.status(500).json({ error: 'Error al obtener estadísticas' });
            }
            
            stats.totalRoutes = routeCount.count;
            
            // Contar tours realizados
            db.get('SELECT COUNT(*) as count FROM tour_history', (err, tourCount) => {
                if (err) {
                    return res.status(500).json({ error: 'Error al obtener estadísticas' });
                }
                
                stats.totalToursCompleted = tourCount.count;
                res.json(stats);
            });
        });
    });
});

// API para obtener lista de usuarios
app.get('/api/admin/users', requireAdmin, (req, res) => {
    const query = `
        SELECT u.id, u.username, u.email, u.role, u.created_at,
               COUNT(th.id) as tours_completed,
               MAX(th.started_at) as last_tour_date
        FROM users u
        LEFT JOIN tour_history th ON u.id = th.user_id
        GROUP BY u.id, u.username, u.email, u.role, u.created_at
        ORDER BY u.created_at DESC
    `;
    
    db.all(query, (err, users) => {
        if (err) {
            return res.status(500).json({ error: 'Error al obtener usuarios' });
        }
        res.json(users);
    });
});

// API para obtener historial de tours de un usuario
app.get('/api/admin/users/:id/tours', requireAdmin, (req, res) => {
    const userId = req.params.id;
    
    const query = `
        SELECT th.*, tr.name as route_name, tr.icon as route_icon
        FROM tour_history th
        LEFT JOIN tour_routes tr ON th.tour_route_id = tr.id
        WHERE th.user_id = ?
        ORDER BY th.started_at DESC
    `;
    
    db.all(query, [userId], (err, tours) => {
        if (err) {
            return res.status(500).json({ error: 'Error al obtener historial de tours' });
        }
        res.json(tours);
    });
});

// API para cambiar rol de usuario
app.put('/api/admin/users/:id/role', requireAdmin, (req, res) => {
    const userId = req.params.id;
    const { role } = req.body;
    
    if (!['user', 'admin'].includes(role)) {
        return res.status(400).json({ error: 'Rol inválido' });
    }
    
    db.run('UPDATE users SET role = ? WHERE id = ?', [role, userId], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Error al actualizar rol' });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        res.json({ success: true, message: 'Rol actualizado exitosamente' });
    });
});

// API para eliminar usuario
app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
    const userId = req.params.id;
    
    // No permitir eliminar el propio usuario admin
    if (parseInt(userId) === req.session.userId) {
        return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
    }
    
    // Primero eliminar historial de tours
    db.run('DELETE FROM tour_history WHERE user_id = ?', [userId], (err) => {
        if (err) {
            return res.status(500).json({ error: 'Error al eliminar historial' });
        }
        
        // Luego eliminar usuario
        db.run('DELETE FROM users WHERE id = ?', [userId], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Error al eliminar usuario' });
            }
            
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Usuario no encontrado' });
            }
            
            res.json({ success: true, message: 'Usuario eliminado exitosamente' });
        });
    });
});

// API para resetear contraseña de usuario
app.put('/api/admin/users/:id/password', requireAdmin, async (req, res) => {
    const userId = req.params.id;
    const { newPassword } = req.body;
    
    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    
    try {
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        
        db.run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Error al actualizar contraseña' });
            }
            
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Usuario no encontrado' });
            }
            
            res.json({ success: true, message: 'Contraseña actualizada exitosamente' });
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al procesar contraseña' });
    }
});

// ========== FIN RUTAS ADMINISTRATIVAS ==========

// API para iniciar un tour
app.post('/api/start-tour', requireAuth, (req, res) => {
    const { tourType } = req.body;
    
    if (!tourType) {
        return res.status(400).json({ error: 'Tipo de tour requerido' });
    }

    // Aquí se integraría con el sistema del robot
    // Por ahora simulamos el inicio del tour
    const tourId = Math.random().toString(36).substr(2, 9);
    const PIN = Math.floor(10000 + Math.random() * 90000); // Generar un PIN aleatorio de 5 dígitos
    
    // Mapear nombres de tours
    const tourNames = {
        'da-vinci': 'Obras de Da Vinci',
        'renacimiento': 'Arte Renacentista',
        'impresionismo': 'Impresionismo Francés',
        'contemporaneo': 'Arte Contemporáneo',
        'arte-espanol': 'Arte Real Español',
        'familiar': 'Tour Familiar'
    };
    
    const tourName = tourNames[tourType] || tourType;
    
    // Guardar en historial de tours
    db.run(
        'INSERT INTO tour_history (user_id, tour_type, tour_name, tour_id, pin) VALUES (?, ?, ?, ?, ?)',
        [req.session.userId, tourType, tourName, tourId, PIN],
        function(err) {
            if (err) {
                console.error('Error al guardar historial de tour:', err);
                // Continuar aunque no se pueda guardar el historial
            }
        }
    );
    
    res.json({ 
        success: true, 
        message: `Tour ${tourType} iniciado exitosamente`,
        tourId: tourId,
        PIN: PIN,
        startTime: new Date().toISOString()
    });
});

// API para login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Usuario/Email y contraseña son requeridos' });
    }

    // Buscar por username o email
    db.get('SELECT * FROM users WHERE username = ? OR email = ?', [username, username], async (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Error en la base de datos' });
        }

        if (!user) {
            return res.status(401).json({ error: 'Usuario/Email o contraseña incorrectos' });
        }

        try {
            const validPassword = await bcrypt.compare(password, user.password);
            if (validPassword) {
                req.session.userId = user.id;
                req.session.username = user.username;
                req.session.userRole = user.role;
                
                // Si es admin, redirigir al panel administrativo
                if (user.role === 'admin') {
                    res.json({ 
                        success: true, 
                        message: 'Login exitoso',
                        isAdmin: true,
                        redirectTo: '/admin'
                    });
                } else {
                    res.json({ success: true, message: 'Login exitoso' });
                }
            } else {
                res.status(401).json({ error: 'Usuario/Email o contraseña incorrectos' });
            }
        } catch (error) {
            res.status(500).json({ error: 'Error al verificar contraseña' });
        }
    });
});

// API para registro
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        db.run('INSERT INTO users (username, email, password) VALUES (?, ?, ?)', 
            [username, email, hashedPassword], function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    res.status(400).json({ error: 'El usuario o email ya existe' });
                } else {
                    res.status(500).json({ error: 'Error al crear usuario' });
                }
            } else {
                res.json({ success: true, message: 'Usuario creado exitosamente' });
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al procesar la contraseña' });
    }
});

// API para obtener info del usuario
app.get('/api/user', requireAuth, (req, res) => {
    db.get('SELECT id, username, email, role, created_at FROM users WHERE id = ?', 
        [req.session.userId], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Error en la base de datos' });
        }
        res.json(user);
    });
});

// API para logout
app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Error al cerrar sesión' });
        }
        // Limpiar la cookie de sesión
        res.clearCookie('connect.sid');
        res.json({ success: true, message: 'Sesión cerrada' });
    });
});

// ===== RUTAS DEL ROBOT =====

// Servir la página de control del robot
app.get('/robot', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'robot.html'));
});

// API para obtener estado del robot
app.get('/api/robot/status', requireAuth, (req, res) => {
    const status = robotManager.getStatus();
    const robotInfo = robotManager.getRobotInfo();
    
    res.json({
        ...status,
        robot_info: robotInfo,
        topics_available: [
            '/mobile_base/commands/velocity',
            '/odom',
            '/laser',
            '/camera/color/image_raw',
            '/diagnostics',
            '/imu/data',
            '/mobile_base/sensors/bumper_pointcloud',
            '/mobile_base/sensors/core',
            '/tf',
            '/map',
            '/move_base/goal',
            '/amcl_pose',
            '/initialpose'
        ]
    });
});

// API para comandos básicos del robot
app.post('/api/robot/command', requireAuth, (req, res) => {
    const { action, parameters = {} } = req.body;
    let result;
    
    try {
        switch (action) {
            case 'move_forward':
                result = robotManager.moveForward(parameters.speed || 0.2);
                break;
            case 'move_backward':
                result = robotManager.moveBackward(parameters.speed || 0.2);
                break;
            case 'turn_left':
                result = robotManager.turnLeft(parameters.speed || 0.5);
                break;
            case 'turn_right':
                result = robotManager.turnRight(parameters.speed || 0.5);
                break;
            case 'stop':
                result = robotManager.stopRobot();
                break;
            case 'custom_velocity':
                result = robotManager.sendVelocityCommand(
                    parameters.linear || 0, 
                    parameters.angular || 0
                );
                break;
            default:
                return res.status(400).json({ error: 'Acción no reconocida' });
        }
        
        // Log de la acción en la base de datos
        const logQuery = `INSERT INTO robot_commands (user_id, action, parameters, timestamp) 
                          VALUES (?, ?, ?, datetime('now'))`;
        
        // Crear tabla de comandos si no existe
        db.run(`CREATE TABLE IF NOT EXISTS robot_commands (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            action TEXT,
            parameters TEXT,
            timestamp DATETIME,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`, (err) => {
            if (err && !err.message.includes('already exists')) {
                console.log('Tabla robot_commands creada');
            }
        });
        
        db.run(logQuery, [req.session.userId, action, JSON.stringify(parameters)], function(err) {
            if (err) {
                console.error('Error al registrar comando:', err.message);
            }
        });
        
        res.json({ 
            success: result.success, 
            message: result.message || result.error,
            action: action,
            parameters: parameters,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// API para obtener información detallada del robot
app.get('/api/robot/info', requireAuth, (req, res) => {
    const robotInfo = robotManager.getRobotInfo();
    const status = robotManager.getStatus();
    
    res.json({
        ...robotInfo,
        connection_status: status,
        available_actions: [
            'move_forward',
            'move_backward', 
            'turn_left',
            'turn_right',
            'stop',
            'custom_velocity'
        ]
    });
});

// API para obtener lista de tópicos en tiempo real
app.get('/api/robot/topics', requireAuth, (req, res) => {
    if (!robotManager.connected) {
        return res.status(503).json({ 
            error: 'Robot no conectado',
            topics: []
        });
    }

    // Simular obtención de tópicos (en una implementación real, 
    // esto se obtendría directamente del robot via rosbridge)
    const simulatedTopics = [
        '/mobile_base/commands/velocity',
        '/odom', 
        '/laser',
        '/camera/color/image_raw',
        '/diagnostics',
        '/imu/data',
        '/mobile_base/sensors/bumper_pointcloud',
        '/mobile_base/sensors/core',
        '/tf',
        '/tf_static',
        '/clock',
        '/rosout',
        '/rosout_agg'
    ];

    res.json({
        success: true,
        topic_count: simulatedTopics.length,
        topics: simulatedTopics,
        timestamp: new Date().toISOString()
    });
});

// API para historial de comandos del robot (solo admin)
app.get('/api/admin/robot/commands', requireAuth, requireAdmin, (req, res) => {
    const query = `
        SELECT rc.*, u.username 
        FROM robot_commands rc
        JOIN users u ON rc.user_id = u.id
        ORDER BY rc.timestamp DESC
        LIMIT 100
    `;
    
    db.all(query, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

// Cerrar base de datos cuando se cierre la aplicación
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Conexión a la base de datos cerrada');
        process.exit(0);
    });
});
