const { GoogleGenerativeAI } = require('@google/generative-ai');
const { AppError } = require('../errors');

const stripMarkdownCodeFence = (text) => {
    const trimmed = String(text || '').trim();
    if (!trimmed.startsWith('```')) return trimmed;
    return trimmed.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
};

const dataUrlToInlineData = (dataUrl) => {
    if (!dataUrl || !dataUrl.includes(';base64,')) return null;
    const [mime, base64] = dataUrl.split(';base64,');
    return { data: base64, mimeType: mime.split(':')[1] };
};

const toReferenceParts = (references = []) => (
    references.flatMap((reference) => {
        const inlineData = dataUrlToInlineData(reference?.data);
        return inlineData ? [{ text: `Reference image for: ${reference.name}` }, { inlineData }] : [];
    })
);

const extractImageResponse = (response) => {
    const parts = response.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((part) => part.inlineData);
    return imagePart
        ? { type: 'image', data: imagePart.inlineData.data, mimeType: imagePart.inlineData.mimeType }
        : null;
};

const routeIsImage = (routeKey) => ['pageImage', 'panelImage', 'imageEdit'].includes(routeKey);

const requireProvider = (settings, routeKey) => {
    const route = settings.routes[routeKey];
    const provider = settings.providers[route.provider];
    if (!provider?.enabled) {
        throw new AppError(400, `${route.provider} provider is not enabled for ${routeKey}`);
    }
    if (!provider.apiKey && route.provider !== 'custom') {
        throw new AppError(400, `${provider.label || route.provider} API key not configured for ${routeKey}`);
    }
    if ((route.provider === 'custom' || route.provider === 'openrouter' || route.provider === 'openai') && !provider.baseUrl) {
        throw new AppError(400, `${provider.label || route.provider} base URL not configured for ${routeKey}`);
    }
    if (routeIsImage(routeKey) && !provider.capabilities.imageOutput) {
        throw new AppError(400, 'Selected provider does not support image generation/editing.');
    }
    return { model: route.model, provider, providerKey: route.provider };
};

const normalizeUsage = (usage = {}) => ({
    candidatesTokenCount: usage.candidatesTokenCount || usage.completion_tokens || usage.output_tokens || 0,
    promptTokenCount: usage.promptTokenCount || usage.prompt_tokens || usage.input_tokens || 0,
    totalTokenCount: usage.totalTokenCount || usage.total_tokens || 0,
});

const fetchJson = async (url, { apiKey, body, headers = {}, method = 'POST' }) => {
    const response = await fetch(url, {
        method,
        headers: {
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            'Content-Type': 'application/json',
            ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(async () => ({ error: await response.text() }));
    if (!response.ok) {
        throw new AppError(response.status, payload?.error?.message || payload?.error || `Provider request failed with status ${response.status}`);
    }
    return payload;
};

const callOpenAiCompatibleText = async ({ json = false, messages, model, provider }) => {
    const baseUrl = provider.baseUrl.replace(/\/$/, '');
    if (baseUrl.includes('api.openai.com')) {
        const payload = await fetchJson(`${baseUrl}/responses`, {
            apiKey: provider.apiKey,
            body: {
                input: messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join('\n\n'),
                model,
                ...(json ? { text: { format: { type: 'json_object' } } } : {}),
            },
        });
        const text = payload.output_text
            || payload.output?.flatMap((item) => item.content || []).map((content) => content.text).filter(Boolean).join('\n')
            || '';
        return { text, usage: normalizeUsage(payload.usage) };
    }

    const payload = await fetchJson(`${baseUrl}/chat/completions`, {
        apiKey: provider.apiKey,
        body: {
            messages,
            model,
            ...(json ? { response_format: { type: 'json_object' } } : {}),
        },
    });
    return {
        text: payload.choices?.[0]?.message?.content || '',
        usage: normalizeUsage(payload.usage),
    };
};

const callOpenAiCompatibleImage = async ({ model, prompt, provider }) => {
    const baseUrl = provider.baseUrl.replace(/\/$/, '');
    const payload = await fetchJson(`${baseUrl}/images/generations`, {
        apiKey: provider.apiKey,
        body: {
            model,
            n: 1,
            prompt,
            response_format: 'b64_json',
        },
    });
    const data = payload.data?.[0]?.b64_json;
    if (!data) throw new AppError(500, 'Image provider did not return image data');
    return { result: { type: 'image', data, mimeType: 'image/png' }, usage: normalizeUsage(payload.usage) };
};

const makePlannerPrompt = ({ appMode, assetList, story, targetPageCount }) => (
    appMode === 'storybook'
        ? `Task: Act as a Children's Storybook Illustrator and Art Director.
Break down the following story into ${targetPageCount ? `EXACTLY ${targetPageCount}` : 'a logical sequence of'} illustrative sections.
Story: """${story}"""
Available Assets in Library: ${JSON.stringify(assetList)}
Return ONLY a JSON array of ${targetPageCount ? `EXACTLY ${targetPageCount} ` : ''}objects with keys: "pageNumber", "storySegment", "startAnchor", "endAnchor", "pageContent", "panelCount", "suggestedReferences".`
        : `Task: Act as a Manga Storyboard Artist and Scriptwriter.
Break down the following story portion into ${targetPageCount ? `EXACTLY ${targetPageCount}` : 'a logical sequence of'} manga pages.
Story: """${story}"""
Available Assets in Library: ${JSON.stringify(assetList)}
Return ONLY a JSON array of ${targetPageCount ? `EXACTLY ${targetPageCount} ` : ''}objects with keys: "pageNumber", "storySegment", "startAnchor", "endAnchor", "pageContent", "panelCount", "suggestedReferences".`
);

const makePagePrompt = ({ appMode, artStyle, aspectRatio, colorMode, mode, panels, prompt, textDensity }) => {
    const isStorybook = appMode === 'storybook';
    if (isStorybook || mode === 'full' || mode === 'storybook') {
        return `${isStorybook ? "Acting as a professional children's book illustrator" : 'Acting as a professional manga artist'}, generate a SINGLE high-fidelity ${isStorybook ? 'storybook illustration' : 'manga page'}.
Story Context: ${prompt}
Visual style: ${colorMode === 'color' ? 'Full color' : 'Black and white'}, art style ${artStyle || 'default'}, aspect ratio ${aspectRatio || 'portrait'}.
Text/detail density: ${textDensity}. Use about ${panels || 1} panels for manga pages.
Do not return text; return one image.`;
    }
    return `Task: Acting as a professional manga storyboard artist, generate a detailed panel-by-panel breakdown.
Story Snippet: ${prompt}
Number of Panels: ${panels}
Visual Style: ${colorMode === 'color' ? 'Full Color' : 'Black & White'}
Text/Detail Level: ${textDensity}
Return only JSON with title, summary, and panels array.`;
};

const makePanelPrompt = ({ aspectRatio, colorMode, panel, textDensity }) => `Acting as a professional manga artist, generate EXACTLY ONE high-fidelity manga panel.
Aspect ratio: ${aspectRatio || 'portrait'}.
Color: ${colorMode === 'color' ? 'Full color' : 'Black and white'}.
Text/detail density: ${textDensity}.
Layout: ${panel.layout}
Composition: ${panel.composition}
Dialogue: ${panel.dialogue || 'None'}
Sound Effects: ${panel.fx || 'None'}`;

const createAiService = ({ aiSettingsStore }) => {
    const getSettingsAndRoute = async (routeKey) => {
        const settings = await aiSettingsStore.getEffectiveSettings();
        const route = requireProvider(settings, routeKey);
        return {
            settings,
            ...route,
            route: { model: route.model, provider: route.providerKey, routeKey },
        };
    };

    const googleModel = (provider, model) => new GoogleGenerativeAI(provider.apiKey).getGenerativeModel({ model });

    const callText = async (routeKey, prompt, { references = [], json = false } = {}) => {
        const { model, provider, providerKey, route } = await getSettingsAndRoute(routeKey);
        if (providerKey === 'google') {
            const result = await googleModel(provider, model).generateContent({
                contents: [{
                    role: 'user',
                    parts: [
                        { text: prompt },
                        ...(provider.capabilities.imageInput ? toReferenceParts(references) : references.map((reference) => ({ text: `Reference: ${reference.name}` }))),
                    ],
                }],
                ...(json ? { generationConfig: { responseMimeType: 'application/json' } } : {}),
            });
            return { route, text: stripMarkdownCodeFence(result.response.text()), usage: result.response.usageMetadata };
        }
        const response = await callOpenAiCompatibleText({
            json,
            messages: [{ role: 'user', content: `${prompt}\n\nReferences: ${(references || []).map((reference) => reference.name).join(', ')}` }],
            model,
            provider,
        });
        return { ...response, route };
    };

    const callImage = async (routeKey, prompt, { references = [] } = {}) => {
        const { model, provider, providerKey, route } = await getSettingsAndRoute(routeKey);
        if (providerKey === 'google') {
            const result = await googleModel(provider, model).generateContent({
                contents: [{ role: 'user', parts: [{ text: prompt }, ...toReferenceParts(references)] }],
                generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
            });
            const response = await result.response;
            return { result: extractImageResponse(response) || response.text(), route, usage: response.usageMetadata };
        }
        const response = await callOpenAiCompatibleImage({ model, prompt, provider });
        return { ...response, route };
    };

    const planStory = async ({ appMode, assetList, story, targetPageCount }) => {
        const { route, text, usage } = await callText('planner', makePlannerPrompt({ appMode, assetList, story, targetPageCount }), { json: true });
        const parsed = JSON.parse(stripMarkdownCodeFence(text));
        return { pages: Array.isArray(parsed) ? parsed : parsed.pages || [], route, usage };
    };

    const generate = async (payload) => {
        const isImageGeneration = payload.mode === 'full' || payload.mode === 'storybook' || payload.appMode === 'storybook';
        const prompt = makePagePrompt(payload);
        if (isImageGeneration) return callImage('pageImage', prompt, { references: payload.references });
        const { route, text, usage } = await callText('storyboard', prompt, { json: true, references: payload.references });
        try {
            return { result: JSON.parse(stripMarkdownCodeFence(text)), route, usage };
        } catch {
            return { result: text, route, usage };
        }
    };

    const generatePanel = async (payload) => callImage('panelImage', makePanelPrompt(payload), { references: payload.references });

    const editImage = async ({ assets, compositeImageData, imageDimensions, mode, originalImageData, prompt }) => {
        if (!originalImageData) throw new AppError(400, 'Original image data is missing');
        if (mode !== 'insert' && !compositeImageData) throw new AppError(400, 'Composite image data is missing');
        const extraAssets = Array.isArray(assets) ? assets.map((asset) => asset.name).join(', ') : '';
        const editPrompt = mode === 'insert'
            ? `Regenerate this scene with these characters added: ${extraAssets}. ${prompt || ''}`
            : `Edit only the highlighted area. Instruction: ${prompt}. Preserve all other areas.`;
        return callImage('imageEdit', `${editPrompt}\nOutput dimensions: ${imageDimensions ? `${imageDimensions.width}x${imageDimensions.height}` : 'same as original'}`, {
            references: [{ name: 'original image', data: originalImageData }, ...(compositeImageData ? [{ name: 'highlight mask reference', data: compositeImageData }] : [])],
        });
    };

    return { editImage, generate, generatePanel, planStory };
};

module.exports = {
    createAiService,
};
