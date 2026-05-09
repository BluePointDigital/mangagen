const path = require('path');
const { readJson, writeJson } = require('./storage');

const AI_SETTINGS_VERSION = 2;

const ROUTE_KEYS = ['planner', 'storyboard', 'pageImage', 'panelImage', 'imageEdit'];
const PROVIDER_KEYS = ['google', 'openai', 'openrouter', 'custom'];

const normalizeString = (value, fallback = '') => (
    typeof value === 'string' && value.trim() ? value.trim() : fallback
);

const normalizeBoolean = (value, fallback = false) => (
    typeof value === 'boolean' ? value : fallback
);

const normalizeNumber = (value, fallback) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : fallback;
};

const buildProviderDefaults = (fallback) => ({
    google: {
        apiKey: fallback.googleApiKey || '',
        baseUrl: '',
        capabilities: { imageInput: true, imageOutput: true, json: true, text: true },
        enabled: true,
        imageModel: fallback.models.proImage,
        label: 'Google Gemini',
        textModel: fallback.models.planner,
    },
    openai: {
        apiKey: process.env.OPENAI_API_KEY || '',
        baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        capabilities: { imageInput: true, imageOutput: true, json: true, text: true },
        enabled: Boolean(process.env.OPENAI_API_KEY),
        imageModel: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1.5',
        label: 'OpenAI',
        textModel: process.env.OPENAI_TEXT_MODEL || 'gpt-5',
    },
    openrouter: {
        apiKey: process.env.OPENROUTER_API_KEY || '',
        baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
        capabilities: { imageInput: false, imageOutput: false, json: true, text: true },
        enabled: Boolean(process.env.OPENROUTER_API_KEY),
        imageModel: '',
        label: 'OpenRouter',
        textModel: process.env.OPENROUTER_TEXT_MODEL || 'openai/gpt-5',
    },
    custom: {
        apiKey: process.env.CUSTOM_AI_API_KEY || '',
        baseUrl: process.env.CUSTOM_AI_BASE_URL || 'http://localhost:1234/v1',
        capabilities: { imageInput: false, imageOutput: false, json: true, text: true },
        enabled: false,
        imageModel: process.env.CUSTOM_AI_IMAGE_MODEL || '',
        label: 'Custom OpenAI-Compatible',
        textModel: process.env.CUSTOM_AI_TEXT_MODEL || 'local-model',
    },
});

const buildDefaultRoutes = (providers) => ({
    planner: { model: providers.google.textModel, provider: 'google' },
    storyboard: { model: providers.google.textModel, provider: 'google' },
    pageImage: { model: providers.google.imageModel, provider: 'google' },
    panelImage: { model: providers.google.imageModel, provider: 'google' },
    imageEdit: { model: providers.google.imageModel, provider: 'google' },
});

const buildDefaultRoutePricing = (pricing = {}, fallbackPricing = {}) => {
    const proPricing = {
        image: normalizeNumber(pricing.pro?.image, fallbackPricing.pro?.image || 0),
        input: normalizeNumber(pricing.pro?.input, fallbackPricing.pro?.input || 0),
        output: normalizeNumber(pricing.pro?.output, fallbackPricing.pro?.output || 0),
    };
    const routePricing = pricing.routes || {};
    const textFallback = { image: 0, input: proPricing.input, output: proPricing.output };
    const imageFallback = { image: proPricing.image, input: proPricing.input, output: proPricing.output };

    return ROUTE_KEYS.reduce((acc, key) => {
        const fallback = key === 'planner' || key === 'storyboard' ? textFallback : imageFallback;
        return {
            ...acc,
            [key]: {
                image: normalizeNumber(routePricing[key]?.image, fallback.image),
                input: normalizeNumber(routePricing[key]?.input, fallback.input),
                output: normalizeNumber(routePricing[key]?.output, fallback.output),
            },
        };
    }, {});
};

const normalizeProvider = (providerKey, provider, fallbackProvider) => ({
    apiKey: normalizeString(provider?.apiKey, fallbackProvider.apiKey),
    baseUrl: normalizeString(provider?.baseUrl, fallbackProvider.baseUrl),
    capabilities: {
        imageInput: normalizeBoolean(provider?.capabilities?.imageInput, fallbackProvider.capabilities.imageInput),
        imageOutput: normalizeBoolean(provider?.capabilities?.imageOutput, fallbackProvider.capabilities.imageOutput),
        json: normalizeBoolean(provider?.capabilities?.json, fallbackProvider.capabilities.json),
        text: normalizeBoolean(provider?.capabilities?.text, fallbackProvider.capabilities.text),
    },
    enabled: normalizeBoolean(provider?.enabled, fallbackProvider.enabled),
    imageModel: normalizeString(provider?.imageModel, fallbackProvider.imageModel),
    label: normalizeString(provider?.label, fallbackProvider.label || providerKey),
    textModel: normalizeString(provider?.textModel, fallbackProvider.textModel),
});

const normalizeRoute = (route, fallbackRoute, providers, routeKey) => {
    const provider = PROVIDER_KEYS.includes(route?.provider) ? route.provider : fallbackRoute.provider;
    const providerConfig = providers[provider];
    const fallbackModel = routeKey === 'pageImage' || routeKey === 'panelImage' || routeKey === 'imageEdit'
        ? providerConfig.imageModel
        : providerConfig.textModel;

    return {
        provider,
        model: normalizeString(route?.model, normalizeString(fallbackRoute.model, fallbackModel)),
    };
};

const migrateV1Settings = (settings = {}, fallback) => {
    const providerDefaults = buildProviderDefaults(fallback);
    const google = {
        ...providerDefaults.google,
        apiKey: normalizeString(settings.googleApiKey, providerDefaults.google.apiKey),
        imageModel: normalizeString(settings.models?.proImage, providerDefaults.google.imageModel),
        textModel: normalizeString(settings.models?.planner, providerDefaults.google.textModel),
    };
    const providers = { ...providerDefaults, google };

    return {
        defaults: settings.defaults,
        pricing: settings.pricing,
        providers,
        routes: {
            planner: { model: normalizeString(settings.models?.planner, google.textModel), provider: 'google' },
            storyboard: { model: normalizeString(settings.models?.creatorPro, google.textModel), provider: 'google' },
            pageImage: { model: normalizeString(settings.models?.proImage, google.imageModel), provider: 'google' },
            panelImage: { model: normalizeString(settings.models?.proImage, google.imageModel), provider: 'google' },
            imageEdit: { model: normalizeString(settings.models?.proImage, google.imageModel), provider: 'google' },
        },
        schemaVersion: AI_SETTINGS_VERSION,
    };
};

const normalizeSettings = (settings, fallback) => {
    const migrated = settings?.schemaVersion === 1 || settings?.models || settings?.googleApiKey
        ? migrateV1Settings(settings, fallback)
        : settings || {};
    const providerDefaults = buildProviderDefaults(fallback);
    const providers = PROVIDER_KEYS.reduce((acc, key) => ({
        ...acc,
        [key]: normalizeProvider(key, migrated.providers?.[key], providerDefaults[key]),
    }), {});
    const defaultRoutes = buildDefaultRoutes(providers);

    return {
        defaults: {
            artStyle: normalizeString(migrated.defaults?.artStyle, fallback.defaults.artStyle),
            aspectRatio: normalizeString(migrated.defaults?.aspectRatio, fallback.defaults.aspectRatio),
            colorMode: normalizeString(migrated.defaults?.colorMode, fallback.defaults.colorMode),
            genMode: normalizeString(migrated.defaults?.genMode, fallback.defaults.genMode),
            textDensity: normalizeString(migrated.defaults?.textDensity, fallback.defaults.textDensity),
        },
        pricing: {
            routes: buildDefaultRoutePricing(migrated.pricing, fallback.pricing),
        },
        providers,
        routes: ROUTE_KEYS.reduce((acc, key) => ({
            ...acc,
            [key]: normalizeRoute(migrated.routes?.[key], defaultRoutes[key], providers, key),
        }), {}),
        schemaVersion: AI_SETTINGS_VERSION,
    };
};

const redactProvider = (provider) => {
    const { apiKey, ...publicProvider } = provider;
    return {
        ...publicProvider,
        hasApiKey: Boolean(apiKey),
    };
};

const toPublicSettings = (settings) => ({
    ...settings,
    hasGoogleApiKey: Boolean(settings.providers.google.apiKey),
    providers: PROVIDER_KEYS.reduce((acc, key) => ({
        ...acc,
        [key]: redactProvider(settings.providers[key]),
    }), {}),
});

const mergeProviderPatch = (currentProvider, patchProvider = {}) => ({
    ...currentProvider,
    ...patchProvider,
    apiKey: normalizeString(patchProvider.apiKey, currentProvider.apiKey),
    capabilities: {
        ...currentProvider.capabilities,
        ...(patchProvider.capabilities || {}),
    },
});

const createAiSettingsStore = ({ config }) => {
    const settingsPath = path.join(config.rootDir, 'settings', 'ai-config.json');

    const readSavedSettings = async () => readJson(settingsPath, null);

    const getEffectiveSettings = async () => {
        const savedSettings = await readSavedSettings();
        return normalizeSettings(savedSettings || {}, config.aiSettings);
    };

    const getPublicSettings = async () => toPublicSettings(await getEffectiveSettings());

    const updateSettings = async (patch = {}) => {
        const current = await getEffectiveSettings();
        const mergedProviders = PROVIDER_KEYS.reduce((acc, key) => ({
            ...acc,
            [key]: mergeProviderPatch(current.providers[key], patch.providers?.[key]),
        }), {});
        const nextSettings = normalizeSettings({
            ...current,
            defaults: { ...current.defaults, ...(patch.defaults || {}) },
            pricing: {
                routes: {
                    ...current.pricing.routes,
                    ...(patch.pricing?.routes || {}),
                },
            },
            providers: mergedProviders,
            routes: { ...current.routes, ...(patch.routes || {}) },
            schemaVersion: AI_SETTINGS_VERSION,
        }, config.aiSettings);

        await writeJson(settingsPath, nextSettings);
        return toPublicSettings(nextSettings);
    };

    return {
        getEffectiveSettings,
        getPublicSettings,
        updateSettings,
    };
};

module.exports = {
    AI_SETTINGS_VERSION,
    ROUTE_KEYS,
    PROVIDER_KEYS,
    createAiSettingsStore,
    normalizeSettings,
    toPublicSettings,
};
