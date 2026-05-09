const { createApp } = require('./server/app');
const { getConfig } = require('./server/config');

const config = getConfig(__dirname);
const app = createApp({ rootDir: config.rootDir });

if (require.main === module) {
    app.listen(config.port, '0.0.0.0', () => {
        console.log(`Server running at http://localhost:${config.port}`);
    });
}

module.exports = {
    app,
    createApp,
};
