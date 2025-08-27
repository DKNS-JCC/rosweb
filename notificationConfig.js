// Configuración del sistema de notificaciones por email
// Este archivo permite personalizar qué eventos generan notificaciones

module.exports = {
    // Configuración general
    general: {
        // Habilitar/deshabilitar todas las notificaciones
        enabled: true,
        
        // Email de destino (si se quiere cambiar desde el código)
        // emailDestination: 'artecrobotics25@gmail.com',
        
        // Tiempo mínimo entre notificaciones del mismo tipo (en minutos)
        throttleTime: 1
    },
    
    // Configuración por tipo de notificación
    notifications: {
        // Notificaciones de usuarios
        USER_CREATED: {
            enabled: true,
            priority: 'low'
        },
        USER_DELETED: {
            enabled: true,
            priority: 'medium'
        },
        
        // Notificaciones de tours
        TOUR_STARTED: {
            enabled: true,
            priority: 'low'
        },
        TOUR_COMPLETED: {
            enabled: true,
            priority: 'low'
        },
        TOUR_ABANDONED: {
            enabled: true,
            priority: 'medium'
        },
        
        // Notificaciones de robot activado
        ROBOT_ACTIVATED: {
            enabled: true,
            priority: 'medium'
        },
        ROBOT_TOUR_STARTED: {
            enabled: true,
            priority: 'medium'
        },
        
        // Notificaciones de batería (CRÍTICAS)
        BATTERY_LOW: {
            enabled: true,
            priority: 'high'
        },
        BATTERY_CRITICAL: {
            enabled: true,
            priority: 'critical'
        },
        
        // Notificaciones del robot (CRÍTICAS)
        ROBOT_ERROR: {
            enabled: true,
            priority: 'high'
        },
        ROBOT_DISCONNECTED: {
            enabled: true,
            priority: 'high'
        },
        ROBOT_RECONNECTED: {
            enabled: true,
            priority: 'medium'
        },
        
        // Notificaciones de rutas
        ROUTE_CREATED: {
            enabled: true,
            priority: 'low'
        },
        ROUTE_DELETED: {
            enabled: true,
            priority: 'medium'
        },
        
        // Notificaciones del sistema
        SYSTEM_ERROR: {
            enabled: true,
            priority: 'critical'
        }
    },
    
    // Configuración de horarios (opcional)
    schedule: {
        // Solo enviar notificaciones en horario de trabajo
        workingHoursOnly: false,
        workingHours: {
            start: '08:00',
            end: '18:00'
        },
        
        // No enviar notificaciones de prioridad baja los fines de semana
        skipLowPriorityOnWeekends: false
    },
    
    // Configuración de throttling para evitar spam
    throttling: {
        // Tiempo mínimo entre notificaciones del mismo tipo (en minutos)
        BATTERY_LOW: 30,           // Una vez cada 30 minutos máximo
        BATTERY_CRITICAL: 15,      // Una vez cada 15 minutos máximo
        ROBOT_ERROR: 10,           // Una vez cada 10 minutos máximo
        ROBOT_DISCONNECTED: 5,     // Una vez cada 5 minutos máximo
        SYSTEM_ERROR: 5,           // Una vez cada 5 minutos máximo
        USER_CREATED: 0,           // Sin throttling
        USER_DELETED: 0,           // Sin throttling
        TOUR_STARTED: 0,           // Sin throttling
        TOUR_COMPLETED: 0,         // Sin throttling
        TOUR_ABANDONED: 2,         // Una vez cada 2 minutos máximo
        ROBOT_ACTIVATED: 0,        // Sin throttling
        ROBOT_TOUR_STARTED: 0,     // Sin throttling  
        ROBOT_RECONNECTED: 5,      // Una vez cada 5 minutos máximo
        ROUTE_CREATED: 0,          // Sin throttling
        ROUTE_DELETED: 0           // Sin throttling
    }
};
