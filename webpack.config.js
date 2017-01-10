const webpack = require('webpack');

module.exports = {
    entry: './public/javascripts/game_scripts/game_main.js',
    output: {
        path: './public/javascripts',
        filename: 'game.bundle.js',
    }
    // module: {
    //     loaders: [{
    //         test: /\.js?$/,
    //         exclude: /node_modules/,
    //         loader: 'babel-loader',
    //     }]
    // }
    // },
    // plugins: [
    //     new webpack.optimize.UglifyJsPlugin({
    //         compress: {
    //             warnings: false,
    //         },
    //         output: {
    //             comments: false,
    //         },
    //     }),
    // ]
}