export const fallbackRoutePricing = {
    planner: { image: 0, input: 2 / 1000000, output: 12 / 1000000 },
    storyboard: { image: 0, input: 2 / 1000000, output: 12 / 1000000 },
    pageImage: { image: 0.134, input: 2 / 1000000, output: 12 / 1000000 },
    panelImage: { image: 0.134, input: 2 / 1000000, output: 12 / 1000000 },
    imageEdit: { image: 0.134, input: 2 / 1000000, output: 12 / 1000000 },
};

export const getRouteKey = (route) => (
    typeof route === 'string' ? route : route?.routeKey
);

export const calculateUsageCost = (route, usage = {}, pricing = {}) => {
    const routeKey = getRouteKey(route);
    const routePricing = pricing?.routes?.[routeKey] || fallbackRoutePricing[routeKey] || { image: 0, input: 0, output: 0 };
    const promptTokens = usage.promptTokenCount || 0;
    const outputTokens = usage.candidatesTokenCount || 0;

    return (promptTokens * routePricing.input) + (outputTokens * routePricing.output) + (routePricing.image || 0);
};
