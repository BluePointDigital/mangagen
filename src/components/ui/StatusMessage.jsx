import React from 'react';

const StatusMessage = ({ message, tone = 'info' }) => {
    if (!message) {
        return null;
    }

    return <div className={`status-message ${tone}`}>{message}</div>;
};

export default StatusMessage;
