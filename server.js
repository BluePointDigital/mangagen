const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Directories
const PROJECTS_DIR = path.join(__dirname, 'projects');
const GLOBAL_LIBRARY_DIRS = {
    characters: path.join(__dirname, 'characters'),
    locations: path.join(__dirname, 'locations'),
    style: path.join(__dirname, 'style'),
};

// Ensure base directories exist
[PROJECTS_DIR, ...Object.values(GLOBAL_LIBRARY_DIRS)].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Helper to get project-specific directories
const getProjectDirs = (projectId) => {
    if (!projectId) return GLOBAL_LIBRARY_DIRS;
    const projectPath = path.join(PROJECTS_DIR, projectId);
    return {
        characters: path.join(projectPath, 'characters'),
        locations: path.join(projectPath, 'locations'),
        style: path.join(projectPath, 'style'),
        pages: path.join(projectPath, 'pages')
    };
};

app.use('/library/characters', express.static(GLOBAL_LIBRARY_DIRS.characters));
app.use('/library/locations', express.static(GLOBAL_LIBRARY_DIRS.locations));
app.use('/library/style', express.static(GLOBAL_LIBRARY_DIRS.style));
// Serve project-specific assets
app.use('/projects/:projectId/:type', (req, res, next) => {
    const { projectId, type } = req.params;
    const projectDirs = getProjectDirs(projectId);
    if (projectDirs[type]) {
        return express.static(projectDirs[type])(req, res, next);
    }
    next();
});

// API: List Projects
app.get('/api/projects', (req, res) => {
    if (!fs.existsSync(PROJECTS_DIR)) return res.json([]);
    const projects = fs.readdirSync(PROJECTS_DIR).filter(f => {
        return fs.statSync(path.join(PROJECTS_DIR, f)).isDirectory();
    }).map(id => {
        const configPath = path.join(PROJECTS_DIR, id, 'project.json');
        let metadata = { id, name: id };
        if (fs.existsSync(configPath)) {
            try {
                metadata = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            } catch (e) { }
        }
        return metadata;
    });
    res.json(projects);
});

// API: Create Project
app.post('/api/projects', (req, res) => {
    const { name } = req.body;
    const id = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const projectPath = path.join(PROJECTS_DIR, id);

    if (fs.existsSync(projectPath)) {
        return res.status(400).json({ error: 'Project already exists' });
    }

    fs.mkdirSync(projectPath, { recursive: true });
    const dirs = getProjectDirs(id);
    Object.values(dirs).forEach(dir => {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });

    const metadata = { id, name, createdAt: new Date().toISOString(), story: '', plannedPages: [] };
    fs.writeFileSync(path.join(projectPath, 'project.json'), JSON.stringify(metadata, null, 2));

    res.json(metadata);
});

// API: Get Project
app.get('/api/projects/:id', (req, res) => {
    const projectPath = path.join(PROJECTS_DIR, req.params.id);
    const configPath = path.join(projectPath, 'project.json');

    if (!fs.existsSync(configPath)) {
        return res.status(404).json({ error: 'Project not found' });
    }

    const metadata = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    res.json(metadata);
});

// API: Save Project Metadata (Story, Planner state, etc.)
app.put('/api/projects/:id', (req, res) => {
    const projectPath = path.join(PROJECTS_DIR, req.params.id);
    const configPath = path.join(projectPath, 'project.json');

    if (!fs.existsSync(projectPath)) {
        return res.status(404).json({ error: 'Project not found' });
    }

    const currentMetadata = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
    const updatedMetadata = { ...currentMetadata, ...req.body, id: req.params.id };

    fs.writeFileSync(configPath, JSON.stringify(updatedMetadata, null, 2));
    res.json(updatedMetadata);
});

// API: List library contents (updated to be project-aware)
app.get('/api/library', (req, res) => {
    const { projectId } = req.query;
    const dirs = getProjectDirs(projectId);
    const library = {};

    Object.keys(dirs).forEach(type => {
        const dir = dirs[type];
        if (!fs.existsSync(dir)) {
            library[type] = [];
            return;
        }
        const files = fs.readdirSync(dir);

        library[type] = files.filter(f => /\.(jpg|jpeg|png|webp|gif|json)$/i.test(f)).map(f => {
            const stats = fs.statSync(path.join(dir, f));
            return {
                name: f,
                url: projectId ? `/projects/${projectId}/${type}/${f}` : `/library/${type}/${f}`,
                type: path.extname(f).toLowerCase() === '.json' ? 'metadata' : 'image',
                mtime: stats.mtime
            };
        });
    });

    res.json(library);
});

// API: Generate Manga
app.post('/api/generate', async (req, res) => {
    const { prompt, references, panels, mode, engine, projectId, colorMode, textDensity, appMode, aspectRatio, artStyle } = req.body;

    if (!process.env.GOOGLE_API_KEY) {
        return res.status(400).json({ error: 'Google API Key not configured' });
    }

    try {
        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

        // Model Mapping
        const models = {
            flash: process.env.CREATOR_FLASH_MODEL || 'gemini-1.5-flash',
            pro: process.env.CREATOR_PRO_MODEL || 'gemini-1.5-pro',
            flashImage: process.env.CREATOR_IMAGE_MODEL_FLASH || 'gemini-1.5-flash',
            proImage: process.env.CREATOR_IMAGE_MODEL_PRO || 'gemini-1.5-pro'
        };

        const isImageGeneration = mode === 'full' || mode === 'storybook' || appMode === 'storybook';
        const modelId = isImageGeneration
            ? (engine === 'pro' ? models.proImage : models.flashImage)
            : (engine === 'pro' ? models.pro : models.flash);

        const model = genAI.getGenerativeModel({
            model: modelId,
            generationConfig: isImageGeneration ? {} : { responseMimeType: "application/json" }
        });

        let systemPrompt;

        // Storybook-specific prompt
        if (appMode === 'storybook') {
            const aspectRatioMap = {
                'square': '1:1 (Square)',
                'portrait': '2:3 (Portrait)',
                'landscape': '3:2 (Landscape)'
            };
            const artStyleMap = {
                'watercolor': 'Watercolor painting with soft, blended colors and organic textures.',
                'oil_painting': 'Rich oil painting with visible brushstrokes and deep colors.',
                'digital_illustration': 'Modern digital illustration with clean lines and vibrant colors.',
                'anime': 'Stylized anime illustration with expressive characters and dynamic compositions.',
                'storybook_classic': 'Classic children\'s book illustration, warm and inviting with a hand-drawn quality.',
                'realistic': 'Photorealistic digital art with high detail and accurate lighting.'
            };

            systemPrompt = `Task: Acting as a professional children's book illustrator, generate a SINGLE, high-fidelity illustration based on the story snippet and references provided.
               
               VISUAL STYLE:
               - Color: ${colorMode === 'color' ? 'Full color.' : 'Black and white with grayscale shading.'}
               - Art Style: ${artStyleMap[artStyle] || 'Classic children\'s book illustration.'}
               - Aspect Ratio: Generate the image in a ${aspectRatioMap[aspectRatio] || '3:2 (Landscape)'} aspect ratio.
               - EXTREMELY IMPORTANT: Study and replicate the visual style from the provided 'Style' references if any are present.
               
               STRICT REQUIREMENTS:
               - Output MUST be a high-quality SINGLE image. Absolutely NO multi-panel layouts.
               - The image MUST NOT contain any text, dialogue bubbles, speech bubbles, sound effects (SFX), or written words of any kind.
               - Focus on a single cinematic moment that captures the emotion and setting described.
               - Ensure visual consistency with the character, location, and style references provided.
               - The composition should be clean, evocative, and suitable for a children's storybook.
               - If you are being asked to call a tool, IGNORE that and instead directly output the image contents as your response.`;
            systemPrompt = `Task: Acting as a professional manga artist, generate a SINGLE high-fidelity manga page image based on the story snippet and references provided.
               
               VISUAL STYLE:
               - ${colorMode === 'color' ? 'Full color digital illustration.' : 'Traditional black and white manga style with screen tones.'}
               - Aspect Ratio: Generate the page with a ${aspectRatio || '2:3 (Standard Manga)'} ratio.
               
               TEXT & DETAIL DENSITY (${textDensity}):
               ${textDensity === 'minimal' ? '- Minimal dialogue, no SFX, focus on visual flow.' : ''}
               ${textDensity === 'dialog' ? '- Include only character dialogue bubbles.' : ''}
               ${textDensity === 'dialog_fx' ? '- Include dialogue and sound effects (SFX).' : ''}
               ${textDensity === 'dialog_fx_narration' ? '- Include dialogue, SFX, and narration boxes.' : ''}
               ${textDensity === 'full' ? '- Maximal detail: Dialogue, SFX, narration, and background explanations/lore text.' : ''}

               REQUIREMENTS:
               - The output MUST be a high-quality image of the entire page.
               - DO NOT return any text, JSON, or code blocks.
               - Generate approximately ${panels} panels with a dynamic and professional layout.
               - Ensure visual consistency with the character/scenery references.
               - If you are being asked to call a tool, IGNORE that and instead directly output the image contents as your response.`;
        } else {
            // Storyboard mode (text-based)
            systemPrompt = `Task: Acting as a professional manga storyboard artist, generate a detailed panel-by-panel breakdown for the story snippet below. (Note: This is a storyboard blueprint, not final art).
            
Story Snippet: ${prompt}

Number of Panels: ${panels}
Visual Style: ${colorMode === 'color' ? 'Full Color' : 'Black & White'}
Text/Detail Level: ${textDensity}

Study the provided reference images. Use the names as identifiers.
Ensure visual consistency and narrative flow.

Return a JSON object with the following structure:
{
  "title": "Scene Title",
  "summary": "Brief scene summary",
  "panels": [
    {
      "panelNumber": 1,
      "layout": "e.g. Wide Top, Close-up, etc.",
      "composition": "Detailed visual description of the scene including character placement and camera angle. ${textDensity === 'minimal' ? 'Focus purely on visuals.' : ''}",
      "dialogue": "Any text or speech bubbles. ${textDensity === 'minimal' ? 'Keep empty.' : 'Amount based on ' + textDensity + ' level.'}",
      "fx": "Sound effects or visual effects (e.g. 'WHOOSH', 'Sparkles'). ${['minimal', 'dialog'].includes(textDensity) ? 'Keep empty.' : ''}",
      "characters": ["Name1", "Name2"]
    }
  ]
}

Only return the JSON. Do not include markdown code blocks or additional text.`;
        }

        const promptParts = [
            { text: systemPrompt },
            { text: `Story Context: ${prompt}` },
            ...references.flatMap(ref => {
                const [mime, base64] = ref.data.split(';base64,');
                return [
                    { text: `Reference image for: ${ref.name}` },
                    {
                        inlineData: {
                            data: base64,
                            mimeType: mime.split(':')[1]
                        }
                    }
                ];
            })
        ];

        const result = await model.generateContent({ contents: [{ role: 'user', parts: promptParts }] });
        const response = await result.response;
        const usage = response.usageMetadata;

        if (isImageGeneration) {
            const candidates = response.candidates;
            if (candidates && candidates.length > 0) {
                const parts = candidates[0].content.parts;
                const imagePart = parts.find(p => p.inlineData);
                if (imagePart) {
                    return res.json({
                        result: { type: 'image', data: imagePart.inlineData.data, mimeType: imagePart.inlineData.mimeType },
                        usage
                    });
                }
            }
            const text = response.text();
            res.json({ result: text, usage });
        } else {
            const text = response.text();
            try {
                const parsed = JSON.parse(text);
                res.json({ result: parsed, usage });
            } catch (e) {
                res.json({ result: text, usage });
            }
        }
    } catch (error) {
        console.error('AI Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: Generate Single Panel
app.post('/api/generate-panel', async (req, res) => {
    const { panel, references, engine, projectId, colorMode, textDensity } = req.body;

    if (!process.env.GOOGLE_API_KEY) {
        return res.status(400).json({ error: 'Google API Key not configured' });
    }

    try {
        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

        // Use Image Models for drawing art
        const models = {
            flashImage: process.env.CREATOR_IMAGE_MODEL_FLASH || 'gemini-1.5-flash',
            proImage: process.env.CREATOR_IMAGE_MODEL_PRO || 'gemini-1.5-pro'
        };

        const modelId = engine === 'pro' ? models.proImage : models.flashImage;

        const model = genAI.getGenerativeModel({
            model: modelId,
            generationConfig: {} // Default to image/content generation
        });

        const systemPrompt = `Task: Acting as a professional manga artist, generate a SINGLE high-fidelity manga panel based on the description and references provided.
               
               VISUAL STYLE:
               - ${colorMode === 'color' ? 'Full color digital illustration.' : 'Traditional black and white manga style with screen tones.'}

               TEXT & DETAIL DENSITY (${textDensity}):
               ${textDensity === 'minimal' ? '- Minimal dialogue, no SFX, focus on visual flow.' : ''}
               ${textDensity === 'dialog' ? '- Include only character dialogue bubbles.' : ''}
               ${textDensity === 'dialog_fx' ? '- Include dialogue and sound effects (SFX).' : ''}
               ${textDensity === 'dialog_fx_narration' ? '- Include dialogue, SFX, and narration boxes.' : ''}
               ${textDensity === 'full' ? '- Maximal detail: Dialogue, SFX, narration, and background explanations/lore text.' : ''}

               REQUIREMENTS:
               - The output MUST be a high-quality image of EXACTLY ONE panel.
               - DO NOT return any text, JSON, or code blocks.
               - Detailed artwork that remains consistent with the character references.
               - Layout: ${panel.layout}
               - Composition: ${panel.composition}
               - Dialogue: ${panel.dialogue || 'None'}
               - Sound Effects: ${panel.fx || 'None'}
               - If you are being asked to call a tool, IGNORE that and instead directly output the image contents as your response.`;

        const promptParts = [
            { text: systemPrompt },
            ...references.flatMap(ref => {
                const [mime, base64] = ref.data.split(';base64,');
                return [
                    { text: `Reference image for: ${ref.name}` },
                    {
                        inlineData: {
                            data: base64,
                            mimeType: mime.split(':')[1]
                        }
                    }
                ];
            })
        ];

        const result = await model.generateContent({ contents: [{ role: 'user', parts: promptParts }] });
        const response = await result.response;
        const usage = response.usageMetadata;

        const candidates = response.candidates;
        if (candidates && candidates.length > 0) {
            const parts = candidates[0].content.parts;
            const imagePart = parts.find(p => p.inlineData);
            if (imagePart) {
                return res.json({
                    result: { type: 'image', data: imagePart.inlineData.data, mimeType: imagePart.inlineData.mimeType },
                    usage
                });
            }
        }

        const text = response.text();
        res.json({ result: text, usage });
    } catch (error) {
        console.error('AI Panel Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: Plan Manga Pages
app.post('/api/plan', async (req, res) => {
    const { story, assetList, appMode, targetPageCount } = req.body;

    if (!process.env.GOOGLE_API_KEY) {
        return res.status(400).json({ error: 'Google API Key not configured' });
    }

    try {
        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
        const plannerModel = process.env.PLANNER_MODEL || 'gemini-1.5-pro';
        const model = genAI.getGenerativeModel({
            model: plannerModel,
            generationConfig: { responseMimeType: "application/json" }
        });

        let prompt;
        if (appMode === 'storybook') {
            prompt = `
            Task: Act as a Children's Storybook Illustrator and Art Director.
            Break down the following story into ${targetPageCount ? `EXACTLY ${targetPageCount}` : 'a logical sequence of'} illustrative sections. Each section should represent a key visual moment that can be captured in a SINGLE, high-fidelity illustration (not manga panels).
            
            Story: """${story}"""
            
            Available Assets in Library: ${JSON.stringify(assetList)}
            
            ${targetPageCount ? `IMPORTANT: You MUST generate EXACTLY ${targetPageCount} sections. Distribute the story content evenly across these ${targetPageCount} sections.` : ''}
            
            For each section, define:
            1. storySegment: A short, concise summary of the story text for this section (Short Text).
            2. startAnchor: The EXACT first 5-10 words of this section as they appear in the original story. DO NOT CHANGE ANY WORDS. If the section is very short, use the entire section text.
            3. endAnchor: The EXACT last 5-10 words of this section as they appear in the original story. DO NOT CHANGE ANY WORDS. If the section is very short, use the entire section text.
            4. pageContent: A detailed, evocative description of the visual scene for this illustration (Image Prompt). Focus on mood, lighting, character positioning, and environment. NO DIALOGUE.
            5. panelCount: ALWAYS 1 (Storybook mode generates one illustration per section).
            6. suggestedReferences: A list of filenames from the provided Available Assets (especially Style references) that should guide the artist.
            
            Return ONLY a JSON array of ${targetPageCount ? `EXACTLY ${targetPageCount} ` : ''}objects with the keys: "pageNumber", "storySegment", "startAnchor", "endAnchor", "pageContent", "panelCount", "suggestedReferences".
        `;
        } else {
            prompt = `
            Task: Act as a Manga Storyboard Artist and Scriptwriter. 
            Break down the following story portion into ${targetPageCount ? `EXACTLY ${targetPageCount}` : 'a logical sequence of'} manga pages.
            
            Story: """${story}"""
            
            Available Assets in Library: ${JSON.stringify(assetList)}
            
            ${targetPageCount ? `IMPORTANT: You MUST generate EXACTLY ${targetPageCount} pages. Distribute the story beats evenly across these ${targetPageCount} pages.` : ''}
            
            For each page, define:
            1. storySegment: A short, concise summary of the content on this page (Short Text).
            2. startAnchor: The EXACT first 5-10 words of this page's script segment as they appear in the original story. DO NOT CHANGE ANY WORDS. If the section is very short, use the entire section text.
            3. endAnchor: The EXACT last 5-10 words of this page's script segment as they appear in the original story. DO NOT CHANGE ANY WORDS. If the section is very short, use the entire section text.
            4. pageContent: A detailed description of the story beats covered on this page (Image Prompt).
            5. panelCount: Number of panels (1-9) recommended for this page.
            6. suggestedReferences: A list of filenames from the provided Available Assets that should be used as references for this page.
            
            Return ONLY a JSON array of ${targetPageCount ? `EXACTLY ${targetPageCount} ` : ''}objects with the keys: "pageNumber", "storySegment", "startAnchor", "endAnchor", "pageContent", "panelCount", "suggestedReferences".
        `;
        }

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        const usage = result.response.usageMetadata;
        const parsed = JSON.parse(responseText);

        // If the AI returned an array directly, wrap it in a pages property
        if (Array.isArray(parsed)) {
            res.json({ pages: parsed, usage });
        } else {
            res.json({ ...parsed, usage });
        }
    } catch (error) {
        console.error('AI Planning Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: Edit Image (In-painting)
app.post('/api/edit', async (req, res) => {
    const { imageData, maskData, prompt, engine, projectId } = req.body;

    if (!process.env.GOOGLE_API_KEY) {
        return res.status(400).json({ error: 'Google API Key not configured' });
    }

    try {
        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
        const models = {
            flashImage: process.env.CREATOR_IMAGE_MODEL_FLASH || 'gemini-1.5-flash',
            proImage: process.env.CREATOR_IMAGE_MODEL_PRO || 'gemini-1.5-pro'
        };

        const modelId = engine === 'pro' ? models.proImage : models.flashImage;
        const model = genAI.getGenerativeModel({ model: modelId });

        const [imageMime, imageBase64] = imageData.split(';base64,');
        const [maskMime, maskBase64] = maskData.split(';base64,');

        const systemPrompt = `Task: Edit the provided image based on the prompt. 
        You are also provided with a 'MASK' image (white areas indicate where changes should be made).
        Modify ONLY the areas indicated by the mask. 
        Keep the rest of the image exactly the same to maintain visual consistency.
        Return ONLY the resulting image. No text or JSON.`;

        const promptParts = [
            { text: systemPrompt },
            { text: `Edit Instruction: ${prompt}` },
            { text: "Original Image:" },
            { inlineData: { data: imageBase64, mimeType: imageMime.split(':')[1] } },
            { text: "Mask (White areas are editable):" },
            { inlineData: { data: maskBase64, mimeType: maskMime.split(':')[1] } }
        ];

        const result = await model.generateContent({ contents: [{ role: 'user', parts: promptParts }] });
        const response = await result.response;
        const candidates = response.candidates;

        if (candidates && candidates.length > 0) {
            const parts = candidates[0].content.parts;
            const imagePart = parts.find(p => p.inlineData);
            if (imagePart) {
                return res.json({
                    result: { type: 'image', data: imagePart.inlineData.data, mimeType: imagePart.inlineData.mimeType },
                    usage: response.usageMetadata
                });
            }
        }

        const text = response.text();
        res.json({ result: text, usage: response.usageMetadata });
    } catch (error) {
        console.error('AI Edit Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: Save Page (updated to be project-aware)
app.post('/api/save', (req, res) => {
    const { filename, imageData, projectId } = req.body;

    if (!projectId) {
        return res.status(400).json({ error: 'projectId is required to save pages' });
    }

    const dirs = getProjectDirs(projectId);
    const filePath = path.join(dirs.pages, filename);
    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");

    fs.writeFile(filePath, base64Data, 'base64', (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, url: `/projects/${projectId}/pages/${filename}` });
    });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
