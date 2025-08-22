// navigation.js - Sistema de navegación por roles

// Función para actualizar la navegación según el rol del usuario
async function updateNavigationByRole() {
    try {
        const response = await fetch('/api/user');
        if (response.ok) {
            const userData = await response.json();
            const userRole = userData.role;
            
            // Elementos de navegación que dependen del rol
            const navAdmin = document.getElementById('navAdmin');
            const navStats = document.getElementById('navStats');
            const navRobotControl = document.getElementById('navRobotControl');
            const navNotifications = document.getElementById('navNotifications');

            // Ocultar todos los elementos admin por defecto
            if (navAdmin) navAdmin.style.display = 'none';
            if (navStats) navStats.style.display = 'none';
            if (navRobotControl) navRobotControl.style.display = 'none';
            if (navNotifications) navNotifications.style.display = 'none';

            // Mostrar elementos según el rol
            switch (userRole) {
                case 'admin':
                    // Administradores tienen acceso completo
                    if (navAdmin) navAdmin.style.display = 'block';
                    if (navStats) navStats.style.display = 'block';
                    if (navRobotControl) navRobotControl.style.display = 'block';
                    if (navNotifications) navNotifications.style.display = 'block';
                    break;
                    
                case 'tecnico':
                    // Técnicos tienen acceso a robot y notificaciones, pero NO a admin ni stats
                    if (navRobotControl) navRobotControl.style.display = 'block';
                    if (navNotifications) navNotifications.style.display = 'block';
                    break;
                    
                case 'user':
                default:
                    // Usuarios normales no tienen acceso a panels administrativos
                    break;
            }
            
            return userData;
        }
    } catch (error) {
        console.error('Error al cargar datos de usuario para navegación:', error);
    }
    return null;
}

// Función para verificar acceso a una página específica
async function checkPageAccess(requiredRoles) {
    try {
        const response = await fetch('/api/user');
        if (response.ok) {
            const userData = await response.json();
            const userRole = userData.role;
            
            if (!requiredRoles.includes(userRole)) {
                // Redirigir según el rol del usuario
                if (userRole === 'admin') {
                    window.location.href = '/admin';
                } else if (userRole === 'tecnico') {
                    window.location.href = '/robot';
                } else {
                    window.location.href = '/';
                }
                return false;
            }
            
            return userData;
        } else {
            window.location.href = '/login';
            return false;
        }
    } catch (error) {
        console.error('Error al verificar acceso:', error);
        window.location.href = '/login';
        return false;
    }
}

// Función para mostrar mensajes de rol
function showRoleBanner(role) {
    const banners = {
        'admin': {
            text: '👑 Panel de Administración - Acceso completo al sistema',
            class: 'admin-banner',
            color: '#dc3545'
        },
        'tecnico': {
            text: '🔧 Panel Técnico - Gestión de tours, robot y notificaciones',
            class: 'tech-banner', 
            color: '#fd7e14'
        }
    };
    
    const banner = banners[role];
    if (!banner) return;
    
    // Crear el banner si no existe
    let bannerElement = document.querySelector(`.${banner.class}`);
    if (!bannerElement) {
        bannerElement = document.createElement('div');
        bannerElement.className = `warning-banner ${banner.class}`;
        bannerElement.style.cssText = `
            background: ${banner.color}15;
            border: 1px solid ${banner.color}40;
            color: ${banner.color};
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
            text-align: center;
            font-weight: 600;
        `;
        bannerElement.innerHTML = `<strong>${banner.text}</strong>`;
        
        // Insertar después del header si existe
        const header = document.querySelector('.admin-header');
        if (header && header.nextSibling) {
            header.parentNode.insertBefore(bannerElement, header.nextSibling);
        }
    }
}

// Exportar funciones para uso global
if (typeof window !== 'undefined') {
    window.updateNavigationByRole = updateNavigationByRole;
    window.checkPageAccess = checkPageAccess;
    window.showRoleBanner = showRoleBanner;
}
