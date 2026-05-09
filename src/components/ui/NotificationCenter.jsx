import React from 'react';

const NotificationCenter = ({ notifications, onDismiss }) => {
    if (!notifications?.length) {
        return null;
    }

    return (
        <div className="notification-center">
            {notifications.map((notification) => (
                <div key={notification.id} className={`notification-toast ${notification.type || 'info'}`}>
                    <div className="notification-body">
                        <strong>{notification.title || 'Notice'}</strong>
                        <span>{notification.message}</span>
                    </div>
                    <button type="button" className="notification-dismiss" onClick={() => onDismiss(notification.id)}>
                        x
                    </button>
                </div>
            ))}
        </div>
    );
};

export default NotificationCenter;
