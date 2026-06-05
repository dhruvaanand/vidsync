import type { Configuration } from 'webpack';
import path from 'path';

export const rendererConfig: Configuration = {
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
          options: { transpileOnly: true },
        },
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.node$/,
        use: 'node-loader',
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    fallback: {
      buffer: false,
      crypto: false,
      stream: false,
      path: false,
      fs: false,
    },
  },
  devServer: {
    client: {
      webSocketURL: 'ws://localhost:3000/ws',
      overlay: {
        warnings: false,
        errors: true,
      },
    },
  },
  output: {
    path: path.resolve(__dirname, '.webpack/renderer'),
  },
};
