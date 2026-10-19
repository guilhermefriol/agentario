// Declaração mínima: o pacote não traz tipos e só usamos a configuração global da fonte.
declare module "troika-three-text" {
  export function configureTextBuilder(config: {
    defaultFontURL?: string | null;
    unicodeFontsURL?: string | null;
    sdfGlyphSize?: number;
    useWorker?: boolean;
  }): void;
}
