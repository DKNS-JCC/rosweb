const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');

// Cargar configuración
let config;
try {
    config = require('./notificationConfig');
} catch (error) {
    console.log('⚠️  Usando configuración por defecto para notificaciones');
    config = {
        general: { enabled: true, throttleTime: 1 },
        notifications: {},
        throttling: {}
    };
}

class EmailNotifier {
    constructor() {
        this.transporter = null;
        this.isEnabled = config.general.enabled;
        this.lastNotifications = new Map(); // Para throttling
        this.setupTransporter();
    }

    setupTransporter() {
        try {
            this.transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: 'artecrobotics25@gmail.com',
                    pass: 'hfbn zftl ycvg fain'
                }
            });
            
            console.log('✅ Sistema de notificaciones por email configurado');
        } catch (error) {
            console.error('❌ Error configurando email:', error);
            this.isEnabled = false;
        }
    }

    async sendNotification(type, data) {
        if (!this.isEnabled || !this.transporter) {
            console.log('📧 Notificación no enviada - Email deshabilitado');
            return false;
        }
        
        // Verificar si la notificación está habilitada
        if (config.notifications[type] && config.notifications[type].enabled === false) {
            console.log(`📧 Notificación ${type} deshabilitada en configuración`);
            return false;
        }
        
        // Verificar throttling
        if (this.shouldThrottle(type)) {
            console.log(`📧 Notificación ${type} throttled - demasiado frecuente`);
            return false;
        }
        
        // Verificar horario de trabajo si está configurado
        if (config.schedule && config.schedule.workingHoursOnly && !this.isWorkingHours()) {
            const priority = config.notifications[type]?.priority || 'medium';
            if (priority !== 'critical') {
                console.log(`📧 Notificación ${type} omitida - fuera de horario laboral`);
                return false;
            }
        }

        try {
            const emailContent = this.generateEmailContent(type, data);
            
            const mailOptions = {
                from: 'artecrobotics25@gmail.com',
                to: config.general.emailDestination || 'artecrobotics25@gmail.com',
                subject: emailContent.subject,
                text: emailContent.body,
                html: emailContent.html
            };

            await this.transporter.sendMail(mailOptions);
            
            // Registrar la notificación para throttling
            this.lastNotifications.set(type, Date.now());
            
            console.log(`✅ Notificación enviada: ${type}`);
            return true;
        } catch (error) {
            console.error(`❌ Error enviando notificación ${type}:`, error);
            return false;
        }
    }
    
    // Verificar si se debe aplicar throttling
    shouldThrottle(type) {
        const throttleMinutes = config.throttling[type];
        if (!throttleMinutes || throttleMinutes === 0) {
            return false;
        }
        
        const lastNotification = this.lastNotifications.get(type);
        if (!lastNotification) {
            return false;
        }
        
        const timeDiff = Date.now() - lastNotification;
        const timeDiffMinutes = timeDiff / (1000 * 60);
        
        return timeDiffMinutes < throttleMinutes;
    }
    
    // Verificar si es horario de trabajo
    isWorkingHours() {
        if (!config.schedule || !config.schedule.workingHours) {
            return true;
        }
        
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentTime = currentHour * 100 + currentMinute;
        
        const startTime = this.parseTime(config.schedule.workingHours.start);
        const endTime = this.parseTime(config.schedule.workingHours.end);
        
        return currentTime >= startTime && currentTime <= endTime;
    }
    
    // Parsear tiempo en formato HH:MM a número
    parseTime(timeStr) {
        const [hours, minutes] = timeStr.split(':').map(Number);
        return hours * 100 + minutes;
    }

    generateEmailContent(type, data) {
        const timestamp = new Date().toLocaleString('es-ES');
        
        switch (type) {
            case 'USER_CREATED':
                return {
                    subject: `[artTEC] Nuevo usuario registrado`,
                    body: `Usuario: ${data.username}\nEmail: ${data.email}\nRol: ${data.role}\nFecha: ${timestamp}`,
                    html: `<p><strong>Nuevo usuario registrado</strong></p>
                           <p>Usuario: ${data.username}<br>
                           Email: ${data.email}<br>
                           Rol: ${data.role}<br>
                           Fecha: ${timestamp}</p>`
                };

            case 'USER_DELETED':
                return {
                    subject: `[artTEC] Usuario eliminado`,
                    body: `Usuario eliminado: ${data.username}\nEmail: ${data.email}\nFecha: ${timestamp}`,
                    html: `<p><strong>Usuario eliminado</strong></p>
                           <p>Usuario: ${data.username}<br>
                           Email: ${data.email}<br>
                           Fecha: ${timestamp}</p>`
                };

            case 'TOUR_STARTED':
                return {
                    subject: `[artTEC] Tour iniciado`,
                    body: `Tour: ${data.tourName}\nUsuario: ${data.username}\nRuta: ${data.routeName}\nFecha: ${timestamp}`,
                    html: `<p><strong>Tour iniciado</strong></p>
                           <p>Tour: ${data.tourName}<br>
                           Usuario: ${data.username}<br>
                           Ruta: ${data.routeName}<br>
                           Fecha: ${timestamp}</p>`
                };

            case 'ROBOT_TOUR_STARTED':
                return {
                    subject: `[artTEC] Tour iniciado en robot ${data.robotId}`,
                    body: `Robot: ${data.robotId}\nTour: ${data.tourName}\nUsuario: ${data.username}\nEmail: ${data.email}\nRuta: ${data.routeName}\nFecha: ${timestamp}`,
                    html: `<p><strong>Tour iniciado en robot</strong></p>
                           <p>Robot: ${data.robotId}<br>
                           Tour: ${data.tourName}<br>
                           Usuario: ${data.username}<br>
                           Email: ${data.email}<br>
                           Ruta: ${data.routeName}<br>
                           Fecha: ${timestamp}</p>`
                };

            case 'ROBOT_ACTIVATED':
                return {
                    subject: `[artTEC] Robot activado via QR`,
                    body: `Robot: ${data.robotName}\nTour: ${data.tourName}\nRuta: ${data.routeName}\nFecha: ${timestamp}`,
                    html: `<p><strong>Robot activado via QR</strong></p>
                           <p>Robot: ${data.robotName}<br>
                           Tour: ${data.tourName}<br>
                           Ruta: ${data.routeName}<br>
                           Fecha: ${timestamp}</p>`
                };

            case 'TOUR_COMPLETED':
                return {
                    subject: `[artTEC] Tour completado`,
                    body: `Tour: ${data.tourName}\nUsuario: ${data.username}\nDuración: ${data.duration}min\nRating: ${data.rating}/5\nFecha: ${timestamp}`,
                    html: `<p><strong>Tour completado</strong></p>
                           <p>Tour: ${data.tourName}<br>
                           Usuario: ${data.username}<br>
                           Duración: ${data.duration} minutos<br>
                           Rating: ${data.rating}/5<br>
                           Fecha: ${timestamp}</p>`
                };

            case 'TOUR_ABANDONED':
                return {
                    subject: `[artTEC] Tour abandonado`,
                    body: `Tour: ${data.tourName}\nUsuario: ${data.username}\nProgreso: ${data.progress}%\nFecha: ${timestamp}`,
                    html: `<p><strong>Tour abandonado</strong></p>
                           <p>Tour: ${data.tourName}<br>
                           Usuario: ${data.username}<br>
                           Progreso: ${data.progress}%<br>
                           Fecha: ${timestamp}</p>`
                };

            case 'BATTERY_LOW':
                return {
                    subject: `[artTEC] ⚠️ Batería baja del robot`,
                    body: `Nivel de batería: ${data.batteryLevel}%\nUbicación: ${data.location || 'Desconocida'}\nFecha: ${timestamp}`,
                    html: `<p><strong>⚠️ Batería baja del robot</strong></p>
                           <p>Nivel: ${data.batteryLevel}%<br>
                           Ubicación: ${data.location || 'Desconocida'}<br>
                           Fecha: ${timestamp}</p>`
                };

            case 'BATTERY_CRITICAL':
                return {
                    subject: `[artTEC] 🚨 Batería crítica del robot`,
                    body: `Nivel de batería: ${data.batteryLevel}%\nRobot deteniéndose\nUbicación: ${data.location || 'Desconocida'}\nFecha: ${timestamp}`,
                    html: `<p><strong>🚨 Batería crítica del robot</strong></p>
                           <p>Nivel: ${data.batteryLevel}%<br>
                           Robot deteniéndose<br>
                           Ubicación: ${data.location || 'Desconocida'}<br>
                           Fecha: ${timestamp}</p>`
                };

            case 'ROBOT_ERROR':
                return {
                    subject: `[artTEC] ❌ Error del robot`,
                    body: `Error: ${data.error}\nDetalles: ${data.details || 'No disponibles'}\nFecha: ${timestamp}`,
                    html: `<p><strong>❌ Error del robot</strong></p>
                           <p>Error: ${data.error}<br>
                           Detalles: ${data.details || 'No disponibles'}<br>
                           Fecha: ${timestamp}</p>`
                };

            case 'ROBOT_DISCONNECTED':
                return {
                    subject: `[artTEC] 📡 Robot desconectado`,
                    body: `Robot perdió conexión\nÚltima ubicación: ${data.lastLocation || 'Desconocida'}\nFecha: ${timestamp}`,
                    html: `<p><strong>📡 Robot desconectado</strong></p>
                           <p>Robot perdió conexión<br>
                           Última ubicación: ${data.lastLocation || 'Desconocida'}<br>
                           Fecha: ${timestamp}</p>`
                };

            case 'ROBOT_RECONNECTED':
                return {
                    subject: `[artTEC] ✅ Robot reconectado`,
                    body: `Robot reconectado exitosamente\nUbicación actual: ${data.location || 'Desconocida'}\nFecha: ${timestamp}`,
                    html: `<p><strong>✅ Robot reconectado</strong></p>
                           <p>Robot reconectado exitosamente<br>
                           Ubicación: ${data.location || 'Desconocida'}<br>
                           Fecha: ${timestamp}</p>`
                };

            case 'ROUTE_CREATED':
                return {
                    subject: `[artTEC] Nueva ruta creada`,
                    body: `Ruta: ${data.routeName}\nWaypoints: ${data.waypointCount}\nCreado por: ${data.createdBy}\nFecha: ${timestamp}`,
                    html: `<p><strong>Nueva ruta creada</strong></p>
                           <p>Ruta: ${data.routeName}<br>
                           Waypoints: ${data.waypointCount}<br>
                           Creado por: ${data.createdBy}<br>
                           Fecha: ${timestamp}</p>`
                };

            case 'ROUTE_DELETED':
                return {
                    subject: `[artTEC] Ruta eliminada`,
                    body: `Ruta eliminada: ${data.routeName}\nTours afectados: ${data.toursCount}\nEliminado por: ${data.deletedBy}\nFecha: ${timestamp}`,
                    html: `<p><strong>Ruta eliminada</strong></p>
                           <p>Ruta: ${data.routeName}<br>
                           Tours afectados: ${data.toursCount}<br>
                           Eliminado por: ${data.deletedBy}<br>
                           Fecha: ${timestamp}</p>`
                };

            case 'SYSTEM_ERROR':
                return {
                    subject: `[artTEC] 🚨 Error del sistema`,
                    body: `Error: ${data.error}\nComponente: ${data.component}\nDetalles: ${data.details || 'No disponibles'}\nFecha: ${timestamp}`,
                    html: `<p><strong>🚨 Error del sistema</strong></p>
                           <p>Error: ${data.error}<br>
                           Componente: ${data.component}<br>
                           Detalles: ${data.details || 'No disponibles'}<br>
                           Fecha: ${timestamp}</p>`
                };

            default:
                return {
                    subject: `[artTEC] Notificación del sistema`,
                    body: `Evento: ${type}\nDatos: ${JSON.stringify(data, null, 2)}\nFecha: ${timestamp}`,
                    html: `<p><strong>Notificación del sistema</strong></p>
                           <p>Evento: ${type}<br>
                           Datos: <pre>${JSON.stringify(data, null, 2)}</pre><br>
                           Fecha: ${timestamp}</p>`
                };
        }
    }

    // Método para deshabilitar temporalmente las notificaciones
    disable() {
        this.isEnabled = false;
        console.log('📧 Notificaciones por email deshabilitadas');
    }

    // Método para habilitar las notificaciones
    enable() {
        this.isEnabled = true;
        console.log('📧 Notificaciones por email habilitadas');
    }

    // Método para verificar el estado del servicio
    async testConnection() {
        if (!this.transporter) {
            return { success: false, message: 'Transporter no configurado' };
        }

        try {
            await this.transporter.verify();
            return { success: true, message: 'Conexión exitosa' };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }
}

// Crear instancia global
const emailNotifier = new EmailNotifier();

module.exports = emailNotifier;
