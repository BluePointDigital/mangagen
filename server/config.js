const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const buildEnvAiSettings = () => ({
    googleApiKey: process.env.GOOGLE_API_KEY || '',
    models: {
        creatorFlash: process.env.CREATOR_FLASH_MODEL || 'gemini-3-flash-preview',
        creatorPro: process.env.CREATOR_PRO_MODEL || 'gemini-3-pro-preview',
        flashImage: process.env.CREATOR_IMAGE_MODEL_FLASH || 'gemini-2.5-flash-image',
        planner: process.env.PLANNER_MODEL || 'gemini-3-flash-preview',
        proImage: process.env.CREATOR_IMAGE_MODEL_PRO || 'gemini-3-pro-image-preview',
    },
    defaults: {
        artStyle: process.env.DEFAULT_ART_STYLE || 'storybook_classic',
        aspectRatio: process.env.DEFAULT_ASPECT_RATIO || 'portrait',
        colorMode: process.env.DEFAULT_COLOR_MODE || 'bw',
        genMode: process.env.DEFAULT_GEN_MODE || 'full',
        textDensity: process.env.DEFAULT_TEXT_DENSITY || 'dialog_fx',
    },
    pricing: {
        flash: {
            image: Number(process.env.GEMINI_FLASH_IMAGE_PRICE) || 0.039,
            input: Number(process.env.GEMINI_FLASH_INPUT_PRICE_PER_TOKEN) || 0.3 / 1000000,
            output: Number(process.env.GEMINI_FLASH_OUTPUT_PRICE_PER_TOKEN) || 2.5 / 1000000,
        },
        pro: {
            image: Number(process.env.GEMINI_PRO_IMAGE_PRICE) || 0.134,
            input: Number(process.env.GEMINI_PRO_INPUT_PRICE_PER_TOKEN) || 2 / 1000000,
            output: Number(process.env.GEMINI_PRO_OUTPUT_PRICE_PER_TOKEN) || 12 / 1000000,
        },
    },
});

const getConfig = (appRoot = path.resolve(__dirname, '..')) => ({
    aiSettings: buildEnvAiSettings(),
    appRoot,
    port: Number(process.env.PORT) || 3001,
    rootDir: process.env.DATA_DIR
        ? path.resolve(process.env.DATA_DIR)
        : appRoot,
});

module.exports = {
    buildEnvAiSettings,
    getConfig,
};
