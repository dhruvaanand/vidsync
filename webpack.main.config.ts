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
  // Output path/filename are set by @electron-forge/plugin-webpack (.webpack/main/index.js)
};
