class AppError extends Error {
    constructor(status, message) {
        super(message);
        this.name = 'AppError';
        this.status = status;
    }
}

const isAppError = (error) => error instanceof AppError;

module.exports = {
    AppError,
    isAppError,
};
