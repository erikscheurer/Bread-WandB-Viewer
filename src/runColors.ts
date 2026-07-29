/**
 * Shared chart palette and deterministic run-color assignment.
 */
export const RUN_COLOR_PALETTES = {
    tableau10: [
        '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f',
        '#edc949', '#af7aa1', '#ff9da7', '#9c755f', '#bab0ac'
    ],
    okabeIto: [
        '#0072b2', '#e69f00', '#009e73', '#d55e00',
        '#cc79a7', '#56b4e9', '#f0e442', '#000000'
    ],
    observable10: [
        '#4269d0', '#efb118', '#ff725c', '#6cc5b0', '#3ca951',
        '#ff8ab7', '#a463f2', '#97bbf5', '#9c6b4e', '#9498a0'
    ],
    colorBrewerDark2: [
        '#1b9e77', '#d95f02', '#7570b3', '#e7298a',
        '#66a61e', '#e6ab02', '#a6761d', '#666666'
    ],
    colorBrewerSet1: [
        '#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00',
        '#ffff33', '#a65628', '#f781bf', '#999999'
    ],
    colorBrewerPaired: [
        '#a6cee3', '#1f78b4', '#b2df8a', '#33a02c', '#fb9a99',
        '#e31a1c', '#fdbf6f', '#ff7f00', '#cab2d6', '#6a3d9a',
        '#ffff99', '#b15928'
    ],
    tolBright: [
        '#4477aa', '#ee6677', '#228833', '#ccbb44',
        '#66ccee', '#aa3377', '#bbbbbb'
    ],
    tolVibrant: [
        '#ee7733', '#0077bb', '#33bbee', '#ee3377',
        '#cc3311', '#009988', '#bbbbbb'
    ],
    tab20: [
        '#1f77b4', '#aec7e8', '#ff7f0e', '#ffbb78', '#2ca02c',
        '#98df8a', '#d62728', '#ff9896', '#9467bd', '#c5b0d5',
        '#8c564b', '#c49c94', '#e377c2', '#f7b6d2', '#7f7f7f',
        '#c7c7c7', '#bcbd22', '#dbdb8d', '#17becf', '#9edae5'
    ],
    plotlyDark24: [
        '#2e91e5', '#e15f99', '#1ca71c', '#fb0d0d', '#da16ff', '#222a2a',
        '#b68100', '#750d86', '#eb663b', '#511cfb', '#00a08b', '#fb00d1',
        '#fc0080', '#b2828d', '#6c7c32', '#778aae', '#862a16', '#a777f1',
        '#620042', '#1616a7', '#da60ca', '#6c4516', '#0d2a63', '#af0038'
    ],
    plotlyAlphabet26: [
        '#aa0dfe', '#3283fe', '#85660d', '#782ab6', '#565656', '#1c8356',
        '#16ff32', '#f7e1a0', '#e2e2e2', '#1cbe4f', '#c4451c', '#dea0fd',
        '#fe00fa', '#325a9b', '#feaf16', '#f8a19f', '#90ad1c', '#f6222e',
        '#1cffce', '#2ed9ff', '#b10da1', '#c075a6', '#fc1cbf', '#b00068',
        '#fbe426', '#fa0087'
    ],
    glasbeyLightBackground64: [
        '#d60000', '#8c3bff', '#018700', '#00acc6', '#e6a500', '#ff7ed1', '#6b004f', '#573b00',
        '#005659', '#15e18c', '#0000dd', '#a17569', '#bcb6ff', '#bf03b8', '#645472', '#790000',
        '#0774d8', '#729a7c', '#ff7752', '#004b00', '#8e7b01', '#f2007b', '#8eba00', '#a57bb8',
        '#5901a3', '#e2afaf', '#a03a52', '#a1c8c8', '#9e4b00', '#546744', '#bac389', '#5e7b87',
        '#60383b', '#8287ff', '#380000', '#e252ff', '#2f5282', '#7ecaff', '#c4668e', '#008069',
        '#919eb6', '#cc7407', '#7e2a8e', '#00bda3', '#2db152', '#4d33ff', '#00e400', '#ff00cd',
        '#c85748', '#e49cff', '#1ca1ff', '#6e70aa', '#c89a69', '#77563b', '#03dae6', '#c1a3c3',
        '#ff6989', '#ba00fd', '#915280', '#9e0174', '#93a14f', '#364424', '#af6dff', '#596d00'
    ],
    glasbeyDarkBackground64: [
        '#d60000', '#018700', '#b500ff', '#05acc6', '#97ff00', '#ffa52f', '#ff8ec8', '#79525e',
        '#00fdcf', '#afa5ff', '#93ac83', '#9a6900', '#366962', '#d3008c', '#fdf490', '#c86e66',
        '#9ee2ff', '#00c846', '#a877ac', '#b8ba01', '#f4bfb1', '#ff28fd', '#f2cdff', '#009e7c',
        '#ff6200', '#56642a', '#953f1f', '#90318e', '#ff3464', '#a0e491', '#8c9ab1', '#829026',
        '#ae083f', '#77c6ba', '#bc9157', '#e48eff', '#72b8ff', '#c6a5c1', '#ff9070', '#d3c37c',
        '#bceddb', '#6b8567', '#916e56', '#f9ff00', '#bac1df', '#ac567c', '#ffcd03', '#ff49b1',
        '#c15603', '#5d8c90', '#c144bc', '#00753f', '#ba6efd', '#00d493', '#00ff75', '#49a150',
        '#cc9790', '#00ebed', '#db7e01', '#f77589', '#b89500', '#c84248', '#00cff9', '#755726'
    ]
} as const;

export type RunColorPaletteName = keyof typeof RUN_COLOR_PALETTES;

export const DEFAULT_RUN_COLOR_PALETTE: RunColorPaletteName = 'tableau10';
export const RUN_COLORS = RUN_COLOR_PALETTES[DEFAULT_RUN_COLOR_PALETTE];

export function isRunColorPaletteName(value: unknown): value is RunColorPaletteName {
    return typeof value === 'string' &&
        Object.prototype.hasOwnProperty.call(RUN_COLOR_PALETTES, value);
}

/**
 * Map a run ID to a stable starting index without depending on discovery order.
 */
export function getStableRunColorIndex(
    runId: string,
    paletteName: RunColorPaletteName = DEFAULT_RUN_COLOR_PALETTE
): number {
    let hash = 117;
    for (let index = 0; index < runId.length; index++) {
        hash ^= runId.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    const palette = RUN_COLOR_PALETTES[paletteName];
    return (hash >>> 0) % palette.length;
}

/**
 * Map a run ID to a stable palette entry without depending on discovery order.
 */
export function getStableRunColor(
    runId: string,
    paletteName: RunColorPaletteName = DEFAULT_RUN_COLOR_PALETTE
): string {
    return RUN_COLOR_PALETTES[paletteName][getStableRunColorIndex(runId, paletteName)];
}
