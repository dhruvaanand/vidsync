import type { Configuration } from 'webpack';

export const mainConfig: Configuration = {
  entry: './src/main/main.ts',
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
          options: { transpileOnly: true },
        },
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  // Output: .webpack/main/index.js — package.json "main" must be ".webpack/main" for Forge.
};
